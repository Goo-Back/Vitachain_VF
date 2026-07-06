"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";

import { computeLogisticsFee, useCart } from "@/lib/cart";
import { placeOrder } from "@/app/[locale]/dashboard/restaurant/orders/actions";
import {
  PAYMENT_PARTNER,
  rememberPaymentChoice,
  type PaymentInstrument,
  type PaymentMethod,
} from "@/lib/payment";

const PREFS_KEY = "vita_delivery_prefs_v1";
const LAST_PAYMENT_KEY = "vita_last_payment_method_v1";

type StoredPrefs = {
  default_region?: string;
  default_notes?: string;
  preferred_day?: string;
  default_contact_name?: string;
  default_phone?: string;
  default_address?: string;
  default_city?: string;
};

type Props = {
  regions: readonly string[];
};

export function CartPageClient({ regions }: Props) {
  const t = useTranslations("restaurant.cart.client");
  const router = useRouter();
  const { lines, updateQuantity, removeFromCart, clearCart, subtotal } = useCart();
  const [region, setRegion] = useState<string>(regions[0] ?? "");
  const [notes, setNotes] = useState<string>("");
  const [contactName, setContactName] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [address, setAddress] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [payment, setPayment] = useState<PaymentMethod>("cod");
  const [codInstrument, setCodInstrument] = useState<PaymentInstrument>("cash");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const PAYMENT_OPTIONS: Array<{
    value: PaymentMethod;
    label: string;
    hint: string;
    badge?: string;
  }> = [
    {
      value: "cod",
      label: t("codLabel"),
      hint: t("codHint"),
      badge: t("codBadge"),
    },
    {
      value: "psp_transfer",
      label: t("pspLabel", { partner: PAYMENT_PARTNER.name }),
      hint: t("pspHint"),
    },
  ];

  // Pull defaults from /settings (localStorage) on first mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFS_KEY);
      if (raw) {
        const prefs = JSON.parse(raw) as StoredPrefs;
        if (prefs.default_region && regions.includes(prefs.default_region)) {
          setRegion(prefs.default_region);
        }
        if (prefs.default_notes) setNotes(prefs.default_notes);
        if (prefs.default_contact_name) setContactName(prefs.default_contact_name);
        if (prefs.default_phone) setPhone(prefs.default_phone);
        if (prefs.default_address) setAddress(prefs.default_address);
        if (prefs.default_city) setCity(prefs.default_city);
      }
      const lastPayment = window.localStorage.getItem(LAST_PAYMENT_KEY);
      if (
        lastPayment &&
        PAYMENT_OPTIONS.some((opt) => opt.value === lastPayment)
      ) {
        setPayment(lastPayment as PaymentMethod);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regions]);

  const logistics = computeLogisticsFee(subtotal);
  const total = subtotal + logistics;

  const groups = useMemo(() => {
    return lines.reduce<Record<string, typeof lines>>((acc, l) => {
      const k = l.ad_snapshot.farmer_id;
      if (!acc[k]) acc[k] = [];
      acc[k]?.push(l);
      return acc;
    }, {});
  }, [lines]);

  function formatError(code: string): string {
    if (code.startsWith("quantity_exceeds_stock"))
      return t("stockInsufficientError");
    if (code.startsWith("ad_not_purchasable"))
      return t("adNotPurchasableError");
    if (code === "not_authenticated") return t("sessionExpiredError");
    return t("genericError", { code });
  }

  function handleSubmit() {
    setError(null);
    if (lines.length === 0) {
      setError(t("emptyCartError"));
      return;
    }
    if (!agreeTerms) {
      setError(t("termsRequiredError"));
      return;
    }
    if (!region) {
      setError(t("regionRequiredError"));
      return;
    }
    if (contactName.trim().length < 2) {
      setError(t("contactNameError"));
      return;
    }
    if (phone.trim().length < 6) {
      setError(t("phoneError"));
      return;
    }
    if (address.trim().length < 4) {
      setError(t("addressError"));
      return;
    }
    if (city.trim().length < 2) {
      setError(t("cityError"));
      return;
    }
    startTransition(async () => {
      // Persist the chosen method so it pre-selects next time. Per-order
      // payment metadata is stashed in sessionStorage by rememberPaymentChoice
      // once the order id is known (POST /orders doesn't accept payment_*
      // fields yet).
      try {
        window.localStorage.setItem(LAST_PAYMENT_KEY, payment);
      } catch {
        // ignore
      }
      try {
        const prevRaw = window.localStorage.getItem(PREFS_KEY);
        const prev = prevRaw ? (JSON.parse(prevRaw) as StoredPrefs) : {};
        window.localStorage.setItem(
          PREFS_KEY,
          JSON.stringify({
            ...prev,
            default_region: region,
            default_contact_name: contactName.trim(),
            default_phone: phone.trim(),
            default_address: address.trim(),
            default_city: city.trim(),
          }),
        );
      } catch {
        // ignore
      }
      const result = await placeOrder({
        delivery_region: region,
        delivery_notes: notes.trim() ? notes.trim() : null,
        delivery_contact_name: contactName.trim(),
        delivery_phone: phone.trim(),
        delivery_address: address.trim(),
        delivery_city: city.trim(),
        payment_method: payment === "cod" ? "COD" : "PSP_TRANSFER",
        items: lines.map((l) => ({
          ad_id: l.ad_id,
          quantity_kg: l.quantity_kg,
        })),
      });
      if (!result.ok) {
        setError(formatError(result.error));
        return;
      }
      rememberPaymentChoice(
        result.order.id,
        payment,
        payment === "cod" ? codInstrument : null,
      );
      clearCart();
      if (payment === "psp_transfer") {
        router.push(`/dashboard/restaurant/orders/${result.order.id}/pay`);
      } else {
        router.push(
          `/dashboard/restaurant/orders/${result.order.id}/confirmation`,
        );
      }
    });
  }

  if (lines.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center">
        <p className="text-sm font-medium text-neutral-900">
          {t("emptyTitle")}
        </p>
        <p className="mt-1 text-sm text-neutral-500">
          {t("emptyBody")}
        </p>
        <Link
          href="/dashboard/restaurant/marketplace"
          className="mt-4 inline-block rounded bg-leaf-600 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-700"
        >
          {t("viewCatalog")}
        </Link>
      </div>
    );
  }

  const stepNumberClass =
    "grid h-5 w-5 place-items-center rounded-full bg-leaf-600 text-[10px] font-semibold text-white";

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {/* Step 1 — Items */}
        <section className="vc-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className={stepNumberClass}>1</span>
            <h2 className="text-sm font-semibold text-neutral-900">
              {t("itemsTitle")}
            </h2>
          </div>
          <div className="space-y-4">
            {Object.entries(groups).map(([farmerId, group]) => {
              const first = group[0];
              if (!first) return null;
              return (
                <div
                  key={farmerId}
                  className="rounded-lg border border-neutral-100 bg-neutral-50/40 p-4"
                >
                  <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
                    {t("producerRegion", { region: first.ad_snapshot.region })}
                  </p>
                  <ul className="divide-y divide-neutral-100">
                    {group.map((l) => {
                      const lineTotal =
                        l.quantity_kg * Number(l.ad_snapshot.price_mad);
                      const stock = Number(l.ad_snapshot.quantity_kg);
                      return (
                        <li key={l.ad_id} className="py-3">
                          <div className="flex items-start gap-4">
                            <div className="flex-1">
                              <p className="text-sm font-medium text-neutral-900">
                                {l.ad_snapshot.title}
                              </p>
                              <p className="text-xs text-neutral-500">
                                {l.ad_snapshot.product_type} ·{" "}
                                {l.ad_snapshot.price_mad} MAD/kg
                              </p>
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateQuantity(
                                      l.ad_id,
                                      Math.max(1, l.quantity_kg - 1),
                                    )
                                  }
                                  className="grid h-7 w-7 place-items-center rounded border border-neutral-200 text-neutral-600 hover:border-leaf-300"
                                  aria-label={t("decreaseAria")}
                                >
                                  −
                                </button>
                                <input
                                  type="number"
                                  min={1}
                                  max={stock}
                                  step={1}
                                  value={l.quantity_kg}
                                  onChange={(e) =>
                                    updateQuantity(
                                      l.ad_id,
                                      Math.max(1, Number(e.target.value)),
                                    )
                                  }
                                  className="w-20 rounded border border-neutral-200 px-2 py-1 text-sm"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateQuantity(
                                      l.ad_id,
                                      Math.min(stock, l.quantity_kg + 1),
                                    )
                                  }
                                  className="grid h-7 w-7 place-items-center rounded border border-neutral-200 text-neutral-600 hover:border-leaf-300"
                                  aria-label={t("increaseAria")}
                                >
                                  +
                                </button>
                                <span className="text-xs text-neutral-500">
                                  {t("stockLabel", { stock })}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeFromCart(l.ad_id)}
                                  className="ml-auto text-xs text-red-600 hover:underline"
                                >
                                  {t("remove")}
                                </button>
                              </div>
                            </div>
                            <p className="text-sm font-semibold text-neutral-900">
                              {lineTotal.toFixed(2)} MAD
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        {/* Step 2 — Delivery */}
        <section className="vc-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className={stepNumberClass}>2</span>
            <h2 className="text-sm font-semibold text-neutral-900">
              {t("addressTitle")}
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="contact_name"
                className="block text-xs font-medium text-neutral-600"
              >
                {t("contactNameLabel")}
              </label>
              <input
                id="contact_name"
                type="text"
                value={contactName}
                maxLength={120}
                onChange={(e) => setContactName(e.target.value)}
                placeholder={t("contactNamePlaceholder")}
                className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="phone"
                className="block text-xs font-medium text-neutral-600"
              >
                {t("phoneLabel")}
              </label>
              <input
                id="phone"
                type="tel"
                value={phone}
                maxLength={30}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("phonePlaceholder")}
                className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor="address"
                className="block text-xs font-medium text-neutral-600"
              >
                {t("addressLabel")}
              </label>
              <input
                id="address"
                type="text"
                value={address}
                maxLength={300}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={t("addressPlaceholder")}
                className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="city"
                className="block text-xs font-medium text-neutral-600"
              >
                {t("cityLabel")}
              </label>
              <input
                id="city"
                type="text"
                value={city}
                maxLength={120}
                onChange={(e) => setCity(e.target.value)}
                placeholder={t("cityPlaceholder")}
                className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="region"
                className="block text-xs font-medium text-neutral-600"
              >
                {t("regionLabel")}
              </label>
              <select
                id="region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
              >
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor="notes"
                className="block text-xs font-medium text-neutral-600"
              >
                {t("notesLabel")}
              </label>
              <textarea
                id="notes"
                rows={3}
                maxLength={500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("notesPlaceholder")}
                className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-[11px] text-neutral-400">
                {t("notesHint")}
              </p>
            </div>
          </div>
        </section>

        {/* Step 3 — Payment */}
        <section className="vc-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className={stepNumberClass}>3</span>
            <h2 className="text-sm font-semibold text-neutral-900">
              {t("paymentTitle")}
            </h2>
          </div>
          <ul className="space-y-2">
            {PAYMENT_OPTIONS.map((opt) => {
              const active = opt.value === payment;
              return (
                <li key={opt.value}>
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                      active
                        ? "border-leaf-400 bg-leaf-50/60 ring-1 ring-leaf-200"
                        : "border-neutral-200 hover:border-leaf-200"
                    }`}
                  >
                    <input
                      type="radio"
                      name="payment_method"
                      value={opt.value}
                      checked={active}
                      onChange={() => setPayment(opt.value)}
                      className="mt-1 h-4 w-4 accent-leaf-600"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-neutral-900">
                          {opt.label}
                        </span>
                        {opt.badge && (
                          <span className="rounded-full bg-leaf-100 px-2 py-0.5 text-[10px] font-medium text-leaf-800">
                            {opt.badge}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-neutral-500">
                        {opt.hint}
                      </p>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>

          {payment === "cod" && (
            <div className="mt-4 rounded-lg border border-leaf-100 bg-leaf-50/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-leaf-700">
                {t("codDetailsTitle")}
              </p>
              <p className="mt-1 text-sm text-neutral-700">
                {t("amountDueLabel")} {" "}
                <span className="font-semibold text-neutral-900">
                  {total.toFixed(2)} MAD
                </span>
              </p>

              <fieldset className="mt-3">
                <legend className="text-xs font-medium text-neutral-600">
                  {t("instrumentLegend")}
                </legend>
                <div className="mt-2 flex gap-2">
                  {(
                    [
                      { v: "cash", l: t("cash") },
                      { v: "check", l: t("check") },
                    ] as const
                  ).map((opt) => {
                    const active = codInstrument === opt.v;
                    return (
                      <label
                        key={opt.v}
                        className={`flex flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs transition ${
                          active
                            ? "border-leaf-400 bg-white text-leaf-800 ring-1 ring-leaf-200"
                            : "border-neutral-200 bg-white text-neutral-600 hover:border-leaf-200"
                        }`}
                      >
                        <input
                          type="radio"
                          name="cod_instrument"
                          value={opt.v}
                          checked={active}
                          onChange={() => setCodInstrument(opt.v)}
                          className="h-3.5 w-3.5 accent-leaf-600"
                        />
                        {opt.l}
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <ul className="mt-3 space-y-1 text-[11px] text-neutral-500">
                <li>• {t("codNote1")}</li>
                <li>• {t("codNote2")}</li>
                <li>• {t("codNote3")}</li>
              </ul>
            </div>
          )}

          {payment === "psp_transfer" && (
            <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                {t("pspOnlineTitle", { partner: PAYMENT_PARTNER.name })}
              </p>
              <p className="mt-1 text-sm text-neutral-700">
                {t("pspOnlineBody", {
                  partner: PAYMENT_PARTNER.name,
                  amount: total.toFixed(2),
                })}
              </p>
              <p className="mt-2 text-[11px] text-blue-700">
                {PAYMENT_PARTNER.tagline}.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Side — summary */}
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="vc-card p-5">
          <h2 className="text-sm font-semibold text-neutral-900">
            {t("summaryTitle")}
          </h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-neutral-500">
                {t("itemsLabel", { count: lines.length })}
              </dt>
              <dd>{subtotal.toFixed(2)} MAD</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">{t("logisticsLabel")}</dt>
              <dd>{logistics.toFixed(2)} MAD</dd>
            </div>
            <div className="flex justify-between border-t border-neutral-200 pt-2 text-base font-semibold">
              <dt>{t("totalLabel")}</dt>
              <dd>{total.toFixed(2)} MAD</dd>
            </div>
          </dl>

          <label className="mt-4 flex cursor-pointer items-start gap-2 text-xs text-neutral-600">
            <input
              type="checkbox"
              checked={agreeTerms}
              onChange={(e) => setAgreeTerms(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-leaf-600"
            />
            <span>
              {t.rich("agreeTerms", {
                link: (chunks) => (
                  <Link
                    href="/dashboard/restaurant/help"
                    className="text-leaf-700 underline-offset-2 hover:underline"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </span>
          </label>

          {error && (
            <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="mt-4 w-full rounded bg-leaf-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-leaf-700 disabled:opacity-60"
          >
            {isPending
              ? t("submitting")
              : t("confirmOrder", { total: total.toFixed(2) })}
          </button>

          <Link
            href="/dashboard/restaurant/marketplace"
            className="mt-2 block text-center text-xs text-neutral-500 hover:text-leaf-700"
          >
            {t("continueShopping")}
          </Link>
        </div>
      </aside>
    </div>
  );
}
