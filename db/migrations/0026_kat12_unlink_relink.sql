-- =============================================================================
-- 0026 — M1 Katara: KAT-12 unlink/relink contract.
-- Story:  KAT-12 (docs/stories/KAT-12-unlink-relink-device.md)
--
-- KAT-02's migration 0017 already shipped two of KAT-12's pre-requisites:
--   * the `UNLINKED` enum variant on public.device_status, and
--   * the `status <> 'UNLINKED'` filter inside public.verify_device_api_key(),
--     which is the SQL gate KAT-03's ingest path reads on every request.
-- So this migration does NOT need to alter the verifier — the filter is
-- already in place. We re-create it with `CREATE OR REPLACE` purely as a
-- tripwire: if a future migration regresses the body, this one re-asserts
-- the contract when it is re-applied (idempotent).
--
-- What is genuinely new here is the freeze trigger that locks the identity
-- columns of an UNLINKED row. Without it, a farmer could (via direct SQL or
-- a future buggy admin UI) repoint an UNLINKED row's parcel_id at a
-- different parcel, smuggling telemetry history across the parcel boundary
-- and breaking KAT-13's invariant. The trigger explicitly allows
-- updated_at + last_seen mutations to flow through — those are operational
-- state, not identity, and the existing set_updated_at() trigger needs to
-- keep stamping them on UNLINKED rows for KAT-13's "last activity" surface.
--
-- Errcode `check_violation` (23514) is the closest semantic fit for "a check
-- on this row's state failed". KAT-12's pgTAP cells assert against this code.
-- =============================================================================

-- ── Verifier — tripwire re-assert of the KAT-02 `status <> 'UNLINKED'` filter ─
-- Re-applied unchanged from 0017 so a future regression is caught at migrate
-- time. extensions.crypt is schema-qualified per the AUTH-05 hardening.
create or replace function public.verify_device_api_key(
    p_device_id text,
    p_api_key   text
)
returns table (
    device_row_id uuid,
    parcel_id     uuid,
    farmer_id     uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select d.id, d.parcel_id, d.farmer_id
      from public.m1_katara_devices d
     where d.device_id     = p_device_id
       and d.status       <> 'UNLINKED'
       and d.api_key_hash  = extensions.crypt(p_api_key, d.api_key_hash)
     limit 1;
$$;

comment on function public.verify_device_api_key(text, text) is
    'KAT-02 verifier, re-asserted by KAT-12: returns device row id + parcel + '
    'farmer on a successful bcrypt compare against an active (non-UNLINKED) '
    'row. Called from KAT-03 ingest path under service_role.';

revoke all on function public.verify_device_api_key(text, text) from public;
grant execute on function public.verify_device_api_key(text, text) to service_role;

-- ── Freeze trigger — UNLINKED rows are read-only on identity columns ─────────
create or replace function public.m1_katara_devices_unlink_freeze()
returns trigger
language plpgsql
as $$
begin
    if old.status = 'UNLINKED'::public.device_status then
        if new.parcel_id     is distinct from old.parcel_id
        or new.farmer_id     is distinct from old.farmer_id
        or new.device_id     is distinct from old.device_id
        or new.api_key_hash  is distinct from old.api_key_hash
        or new.api_key_last4 is distinct from old.api_key_last4
        or new.status        is distinct from old.status then
            raise exception 'm1_katara_devices: UNLINKED row is read-only (KAT-12)'
                using errcode = 'check_violation';
        end if;
    end if;
    return new;
end;
$$;

comment on function public.m1_katara_devices_unlink_freeze() is
    'KAT-12: refuses post-unlink mutation of identity columns. updated_at and '
    'last_seen are allowed through (operational state, not identity).';

drop trigger if exists trg_m1_katara_devices_unlink_freeze
    on public.m1_katara_devices;

create trigger trg_m1_katara_devices_unlink_freeze
    before update on public.m1_katara_devices
    for each row execute function public.m1_katara_devices_unlink_freeze();
