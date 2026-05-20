/**
 * AUTH-01 — SHA-256 of a normalized email, used as a Sentry breadcrumb
 * fingerprint. NEVER store, log, or transmit the raw email alongside the hash.
 */
export async function hashEmail(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
