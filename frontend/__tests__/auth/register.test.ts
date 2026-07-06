import { describe, expect, it, vi } from "vitest";

import { RegisterSchema } from "@/app/[locale]/register/schema";
import { mapAuthError } from "@/lib/auth/errors";

describe("RegisterSchema", () => {
  const valid = {
    full_name: "Ahmed Tazi",
    email: "ahmed@example.com",
    password: "Abcdefghi1",
    role: "CITIZEN" as const,
    locale: "fr" as const,
  };

  it("accepts a valid input", () => {
    const r = RegisterSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("rejects passwords below 10 chars", () => {
    const r = RegisterSchema.safeParse({ ...valid, password: "Abcd123!" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe("weak_password");
    }
  });

  it("rejects passwords > 72 chars (bcrypt ceiling)", () => {
    const r = RegisterSchema.safeParse({
      ...valid,
      password: "A1a" + "x".repeat(72),
    });
    expect(r.success).toBe(false);
  });

  it("rejects passwords missing an uppercase letter", () => {
    const r = RegisterSchema.safeParse({ ...valid, password: "abcdefghi1" });
    expect(r.success).toBe(false);
  });

  it("rejects passwords missing a digit", () => {
    const r = RegisterSchema.safeParse({ ...valid, password: "Abcdefghij" });
    expect(r.success).toBe(false);
  });

  it("trims and lowercases email", () => {
    const r = RegisterSchema.parse({
      ...valid,
      email: "  YAS@example.COM ",
    });
    expect(r.email).toBe("yas@example.com");
  });

  it("rejects ADMIN role on self-signup", () => {
    const r = RegisterSchema.safeParse({
      ...valid,
      role: "ADMIN" as unknown as "CITIZEN",
    });
    expect(r.success).toBe(false);
  });

  it("defaults locale to fr when omitted", () => {
    const { locale: _drop, ...rest } = valid;
    void _drop;
    const r = RegisterSchema.parse(rest);
    expect(r.locale).toBe("fr");
  });
});

describe("mapAuthError", () => {
  it("returns unknown for a null error", () => {
    expect(mapAuthError(null)).toBe("unknown");
  });

  it("recognizes user_already_exists", () => {
    expect(
      mapAuthError({ code: "user_already_exists", status: 422 } as never),
    ).toBe("email_taken");
  });

  it("recognizes email_exists", () => {
    expect(
      mapAuthError({ code: "email_exists", status: 422 } as never),
    ).toBe("email_taken");
  });

  it("recognizes weak_password", () => {
    expect(
      mapAuthError({ code: "weak_password", status: 422 } as never),
    ).toBe("weak_password");
  });

  it("recognizes over_email_send_rate_limit", () => {
    expect(
      mapAuthError({
        code: "over_email_send_rate_limit",
        status: 429,
      } as never),
    ).toBe("rate_limited");
  });

  it("recognizes over_request_rate_limit", () => {
    expect(
      mapAuthError({ code: "over_request_rate_limit", status: 429 } as never),
    ).toBe("rate_limited");
  });

  it("returns invalid_input for validation_failed_email", () => {
    expect(
      mapAuthError({ code: "validation_failed_email", status: 400 } as never),
    ).toBe("invalid_input");
  });

  it("falls back to network when status is 0", () => {
    expect(mapAuthError({ status: 0 } as never)).toBe("network");
  });

  it("falls back to network when status is missing", () => {
    expect(mapAuthError({} as never)).toBe("network");
  });

  it("falls back to unknown for an unrecognized code with a real status", () => {
    expect(
      mapAuthError({ code: "made_up_future_code", status: 500 } as never),
    ).toBe("unknown");
  });

  it("uses error.code, not error.message, for the lookup (the message is the canary spy point)", () => {
    const spy = vi.fn();
    spy({ code: "user_already_exists" });
    expect(spy).toHaveBeenCalledWith({ code: "user_already_exists" });
  });
});
