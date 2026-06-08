"use server";

import { authedApiFetch } from "@/lib/api/authed-fetch";
import { SECONDSERVE_URL } from "@/lib/secondserve";

/**
 * Builds a SecondServe URL that logs the caller in automatically.
 *
 * Calls the backend (`POST /secondserve/handoff`) to mint a single-use
 * magic-link token for the authenticated caller, then appends it to the target
 * URL's hash. SecondServe verifies it on boot (`verifyOtp`) to obtain its own
 * independent session — no shared refresh token. Throws on any failure; the
 * caller falls back to a plain (manual-login) link.
 */
export async function createSecondserveHandoffUrl(path: string): Promise<string> {
  const safePath = path.startsWith("/") ? path : `/${path}`;

  const r = await authedApiFetch("/secondserve/handoff", { method: "POST" });
  if (!r.ok) throw new Error(`secondserve_handoff_failed_${r.status}`);

  const { token_hash } = (await r.json()) as { token_hash: string };
  if (!token_hash) throw new Error("secondserve_handoff_no_token");

  const frag = new URLSearchParams({ ss_handoff: "1", token_hash }).toString();
  return `${SECONDSERVE_URL}${safePath}#${frag}`;
}
