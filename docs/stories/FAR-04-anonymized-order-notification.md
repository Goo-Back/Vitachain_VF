# FAR-04 — Anonymised order notification to producer (no buyer info)

> **Epic:** E3 — M2 FarMarket — B2B Agri-Marketplace
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** System (triggered on order placement)
> **Depends on:** [FAR-03](./FAR-03-restaurateur-places-order.md), [NOT-01](./NOT-01-brevo-transactional-mailer.md)
> **Unblocks:** [FAR-10](./FAR-10-order-tracking.md)
> **Acceptance:** Producer receives a Brevo email within 2 minutes of order placement; the email and its data path contain **zero** restaurant identifiers (name, email, phone, address); BR-F4 (Brevo key only on backend) preserved.
> **Supersedes:** the original FAR-04 lead-email-with-buyer-contact flow (removed in migration 0039 — see [FAR-04-brevo-email-to-seller.md](./FAR-04-brevo-email-to-seller.md) marked OBSOLETE).

---

## 1. Purpose

When a restaurant places an order ([FAR-03](./FAR-03-restaurateur-places-order.md)), each producer with at least one item in the order needs to be told something arrived. The notification must be the **minimum disclosing payload** possible:

- The producer learns: which of their ads got ordered, in what quantities, at the agreed snapshot prices, and to which Moroccan region the goods need to ship.
- The producer does **not** learn: the restaurant's name, legal entity, email, phone, street address, contact person, or any combination of fields that could be triangulated to identify them.

VitaChain is the only party that knows both sides of the transaction. This is the core BR-F5 guarantee from FAR-03 surfaced into the email channel.

---

## 2. Scope

### In scope

- New worker `backend/app/workers/farmarket_order_notify/` that LISTENs on the `farmarket_order_placed` channel emitted by FAR-03.
- A `notified_at` column on `m2_farmarket_orders` (idempotency anchor — worker stamps after Brevo 2xx).
- Brevo template `BREVO_TEMPLATE_FAR_ORDER_FR` / `_AR` / `_EN` with placeholders for: order short code, item list, delivery region, accept/reject deep-link.
- The accept/reject deep-link points to `/dashboard/farmer/orders/{order_id}` — to be served by [FAR-10](./FAR-10-order-tracking.md). The link itself contains no resto identifier.
- A 30-minute backstop scan (same pattern as KAT-09) that retries any order whose first INSERT preceded a worker restart.
- Worker unit tests in `backend/tests/test_far04_order_notification.py`.
- A `delivery_notes` sanitiser: regex-strips email-shaped and phone-shaped substrings before they reach the email body. Belt-and-suspenders; FAR-03's text policy already discourages contact info, but we never trust resto input.

### Out of scope

- The producer-side accept/reject UI → **FAR-10**.
- Email translations beyond FR/AR/EN locales (FR seed templates first, AR/EN flagged TODO).
- SMS fallback if email bounces — post-MVP.

---

## 3. Trigger path

1. FAR-03's order placement transaction emits `pg_notify('farmarket_order_placed', order_id::text)` after the COMMIT.
2. The worker LISTENs on the same channel using a **direct (5432) Postgres URL** — same constraint as KAT-06 / KAT-09. Pooled (`6543`) URLs break the subscription on each statement boundary.
3. On wake-up:
   - Atomic claim: `UPDATE m2_farmarket_orders SET notified_at = now() WHERE id = $1 AND notified_at IS NULL RETURNING 1`. If 0 rows updated, the row was already handled — exit early.
   - Fetch the order header + items + the unique set of `farmer_id`s on the order.
   - For each distinct `farmer_id`:
     - Fetch the producer's profile (`email`, `locale`, `full_name`).
     - Build the per-producer item subset (filtered to their own `farmer_id`).
     - Sanitise `delivery_notes` (strip email/phone patterns).
     - Send Brevo template in producer's locale.
   - Heartbeat to `HEALTHCHECKS_FAR_ORDER_NOTIFY_PING_URL` on success.
4. Failure modes:
   - Brevo 5xx → re-raise; the row stays `notified_at IS NULL` (we wrote it inside the same tx? No — we write `notified_at` only on success: see §4.2 for the corrected ordering).
   - Profile fetch fails → log + Sentry, abort that producer (others still get notified).

### 3.1 Idempotency ordering

The canonical pattern from KAT-09 is: **send first, stamp after**. If the worker dies between Brevo and stamp, the 30-minute backstop re-sends — better a duplicate email than a silent miss. Producer can de-dupe by the order short code in the subject line.

---

## 4. Data Model

### 4.1 Add to existing `m2_farmarket_orders` (migration 0041)

```sql
alter table public.m2_farmarket_orders
    add column if not exists notified_at timestamptz;

create index if not exists m2_farmarket_orders_unnotified_idx
    on public.m2_farmarket_orders (created_at desc)
    where notified_at is null;
```

### 4.2 AFTER COMMIT trigger (migration 0041)

```sql
create or replace function public.m2_farmarket_notify_order_placed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    perform pg_notify('farmarket_order_placed', new.id::text);
    return new;
end;
$$;

revoke execute on function public.m2_farmarket_notify_order_placed() from public;

drop trigger if exists trg_far04_notify_order_placed on public.m2_farmarket_orders;
create trigger trg_far04_notify_order_placed
    after insert on public.m2_farmarket_orders
    for each row
    execute function public.m2_farmarket_notify_order_placed();
```

---

## 5. Email content

### 5.1 Template variables (Brevo `params`)

```json
{
  "order_short_code": "VITA-A1B2",
  "items": [
    { "ad_title": "Tomates cerises BIO", "product_type": "Tomates", "quantity_kg": "25.00", "unit_price_mad": "8.50", "line_total_mad": "212.50" }
  ],
  "items_count": 1,
  "subtotal_mad": "212.50",
  "delivery_region": "Souss-Massa",
  "delivery_notes_sanitised": "Livraison de préférence en matinée.",
  "estimated_pickup_iso": "2026-05-26T08:00:00Z",
  "accept_reject_url": "https://vitachain.ma/dashboard/farmer/orders/<uuid>"
}
```

### 5.2 What is NEVER in the email

- `restaurant_id` UUID.
- Restaurant `full_name`, `email`, `phone`, `legal_name`.
- Any field that could resolve to a city, street, or business name.
- The other producers' items on the same order (each producer gets the slice they own).

Concretely: the worker constructs the payload by joining `m2_farmarket_orders` + `m2_farmarket_order_items` and filtering to a single `farmer_id`. The `restaurant_id` is read for the COMMIT trigger only; it is **never copied into the Brevo `params` dict**.

### 5.3 Subject line

> `[VitaChain] Nouvelle commande VITA-A1B2 — N kg de produits à expédier`

---

## 6. Worker implementation sketch

`backend/app/workers/farmarket_order_notify/__main__.py` (asyncio entry, JSON logging, Sentry init).

`backend/app/workers/farmarket_order_notify/listener.py`:

```python
async def listen_orders(stop_event: asyncio.Event) -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    await conn.add_listener("farmarket_order_placed", _on_notify)
    # plus a 30-minute backstop loop scanning notified_at IS NULL within
    # the last 30 minutes — same shape as katara_diagnostic_email/listener.py
```

`backend/app/workers/farmarket_order_notify/sender.py`:

```python
async def notify_order(order_id: UUID) -> None:
    # 1. claim
    # 2. fetch order + items + distinct farmer_ids
    # 3. for each farmer_id: build per-producer payload, send Brevo, log
    # 4. stamp notified_at on success
```

`backend/app/workers/farmarket_order_notify/sanitise.py`:

```python
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"\b0[5-7]\d{8}\b|\+212\s?\d{9}")

def redact_contact_info(text: str | None) -> str | None:
    if not text:
        return text
    text = _EMAIL_RE.sub("[email redacted]", text)
    text = _PHONE_RE.sub("[phone redacted]", text)
    return text
```

---

## 7. `docker-compose.yml` service entry

Re-add a `farmarket_order_notify_worker` service block under the FAR-04 comment block in `infra/docker-compose.yml` (the placeholder comment from Phase A is the anchor). Reuse the FAR-03/04 env vars but **rename** the Brevo template envs:

```yaml
BREVO_TEMPLATE_FAR_ORDER_FR: ${BREVO_TEMPLATE_FAR_ORDER_FR:-0}
BREVO_TEMPLATE_FAR_ORDER_AR: ${BREVO_TEMPLATE_FAR_ORDER_AR:-0}
BREVO_TEMPLATE_FAR_ORDER_EN: ${BREVO_TEMPLATE_FAR_ORDER_EN:-0}
HEALTHCHECKS_FAR_ORDER_NOTIFY_PING_URL: ${HEALTHCHECKS_FAR_ORDER_NOTIFY_PING_URL:-}
```

Update `infra/.env.example` accordingly.

---

## 8. Verification checklist

- [ ] An INSERT into `m2_farmarket_orders` emits `pg_notify('farmarket_order_placed', id::text)` (verify with `LISTEN` from psql).
- [ ] The worker logs `claimed order <id>` once and only once for a given order_id, even across two worker restarts.
- [ ] The Brevo POST payload (capture via the test fixture) contains **no** `restaurant_id`, `restaurant_email`, `restaurant_phone`, `restaurant_name`, or any field starting with `resto_` / `buyer_` / `customer_`.
- [ ] `delivery_notes_sanitised` redacts an inserted email-shaped string (`foo@bar.com → [email redacted]`).
- [ ] `delivery_notes_sanitised` redacts an inserted Moroccan phone (`0612345678 → [phone redacted]`).
- [ ] When an order has items from two producers A and B, A's email contains only A's items and B's email contains only B's items.
- [ ] If Brevo returns 500, `notified_at` stays NULL and the 30-minute backstop re-tries.
- [ ] If a producer profile is missing, the worker logs a Sentry warning and skips that producer without crashing on the others.

---

## 9. Deliverables

| Artifact | Location |
|---|---|
| Migration | `db/migrations/0041_far04_order_notify.sql` |
| Worker — entry point | `backend/app/workers/farmarket_order_notify/__main__.py` |
| Worker — listener loop | `backend/app/workers/farmarket_order_notify/listener.py` |
| Worker — sender | `backend/app/workers/farmarket_order_notify/sender.py` |
| Worker — sanitiser | `backend/app/workers/farmarket_order_notify/sanitise.py` |
| Worker — package marker | `backend/app/workers/farmarket_order_notify/__init__.py` |
| Brevo template seeds (FR first) | `backend/app/workers/farmarket_order_notify/templates.py` |
| Tests | `backend/tests/test_far04_order_notification.py` |
| Compose entry | edit `infra/docker-compose.yml` (anchor: the FAR-04 placeholder comment) |
| Env vars | edit `infra/.env.example` |
| `spring-status.yml` flip | `FAR-04.status` → `IN_REVIEW` |

---

## 10. Business rules

| Rule | Where enforced |
|---|---|
| BR-F4 (Brevo key only on backend) | Worker runs in the backend container; key in `BREVO_API_KEY` env. Never injected to frontend bundle (CI grep guard). |
| BR-F5 (zero buyer info to producer) | Worker payload construction NEVER references `restaurant_id` after the row lookup; sanitiser strips known leak patterns from `delivery_notes`. |
| Idempotency | `notified_at IS NULL` atomic-claim UPDATE; same pattern as KAT-09. |

---

## 11. Definition of Done

1. Migration 0041 applied.
2. Worker container starts, LISTEN session reachable, logs the listener-attached line.
3. Tests for FAR-04 green (`make -C backend test`).
4. Manual end-to-end: place a 2-producer order as a RESTAURANT, check Brevo dashboard for two distinct emails — one per producer — each filtered to that producer's items only.
5. Sentry no-op for the happy path.
6. `spring-status.yml` flipped; **FAR-10 unblocked**.
