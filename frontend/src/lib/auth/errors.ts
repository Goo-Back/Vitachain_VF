import type { AuthError } from "@supabase/supabase-js";

/**
 * AUTH-01 — Stable, i18n-friendly keys surfaced to the UI.
 * I18N-02 owns translation; QA asserts on the key, not the message.
 */
export type AuthErrorKey =
  | "email_taken"
  | "weak_password"
  | "rate_limited"
  | "invalid_input"
  | "network"
  | "unknown";

type MaybeCodedError = Pick<AuthError, "code" | "status" | "message"> & {
  code?: string;
};

/**
 * Maps a Supabase AuthError to a stable AuthErrorKey.
 *
 * Keep the switch exhaustive on documented Supabase codes; the `default`
 * branch is the canary — anything unrecognized is logged upstream by the
 * Server Action so a future Supabase release surfaces in Sentry instead of
 * dying silently.
 */
export function mapAuthError(
  error: AuthError | MaybeCodedError | null | undefined,
): AuthErrorKey {
  if (!error) return "unknown";

  switch (error.code) {
    case "user_already_exists":
    case "email_exists":
      return "email_taken";
    case "weak_password":
    case "validation_failed":
      return "weak_password";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "rate_limited";
    case "validation_failed_email":
    case "anonymous_provider_disabled":
      return "invalid_input";
    default:
      if (error.status === 0 || error.status === undefined) return "network";
      return "unknown";
  }
}
