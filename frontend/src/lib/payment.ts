/**
 * Frontend-only payment state for the FarMarket buy flow.
 *
 * Backend hasn't yet exposed a payment_method / paid_at field on orders, so
 * checkout choice and the mock-PSP confirmation are held in sessionStorage,
 * keyed by order id. When PAY-* stories ship, replace the storage helpers
 * with a server action / supabase query and keep the rest of the UI as-is.
 */

export type PaymentMethod = "cod" | "psp_transfer";
export type PaymentInstrument = "cash" | "check"; // COD only
export type PaymentStatus = "due" | "paid";

const METHOD_KEY = (orderId: string) => `vita_order_payment_${orderId}`;
const INSTRUMENT_KEY = (orderId: string) =>
  `vita_order_cod_instrument_${orderId}`;
const STATUS_KEY = (orderId: string) => `vita_order_payment_status_${orderId}`;

export const PAYMENT_PARTNER = {
  name: "PayMaroc",
  tagline: "Prestataire de paiement agréé Bank Al-Maghrib",
};

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cod: "Paiement à la livraison",
  psp_transfer: `Virement sécurisé via ${PAYMENT_PARTNER.name}`,
};

export function safeGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // ignore quota / private mode
  }
}

export function rememberPaymentChoice(
  orderId: string,
  method: PaymentMethod,
  instrument: PaymentInstrument | null,
): void {
  safeSet(METHOD_KEY(orderId), method);
  if (method === "cod" && instrument) {
    safeSet(INSTRUMENT_KEY(orderId), instrument);
  }
  // COD is always "due" until reception; PSP starts "due" until PayMaroc echoes success.
  safeSet(STATUS_KEY(orderId), "due");
}

export function readPaymentChoice(orderId: string): {
  method: PaymentMethod | null;
  instrument: PaymentInstrument | null;
  status: PaymentStatus;
} {
  const method = safeGet(METHOD_KEY(orderId)) as PaymentMethod | null;
  const instrument = safeGet(INSTRUMENT_KEY(orderId)) as
    | PaymentInstrument
    | null;
  const status = (safeGet(STATUS_KEY(orderId)) as PaymentStatus | null) ?? "due";
  return { method, instrument, status };
}

export function markPaid(orderId: string): void {
  safeSet(STATUS_KEY(orderId), "paid");
}
