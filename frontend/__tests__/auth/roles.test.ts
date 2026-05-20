import { describe, expect, it } from "vitest";

import {
  ALL_ROLES,
  ROLE_DESCRIPTIONS_FR,
  SELF_SIGNUP_ROLES,
} from "@/lib/auth/roles";
import { RegisterSchema } from "@/app/register/schema";

describe("role constants", () => {
  it("SELF_SIGNUP_ROLES excludes ADMIN", () => {
    expect(SELF_SIGNUP_ROLES).toEqual(["FARMER", "RESTAURANT", "CITIZEN"]);
    expect(SELF_SIGNUP_ROLES).not.toContain("ADMIN");
  });

  it("ALL_ROLES composes SELF_SIGNUP_ROLES + ADMIN", () => {
    expect([...ALL_ROLES].sort()).toEqual(
      ["ADMIN", ...SELF_SIGNUP_ROLES].sort(),
    );
  });

  it("ROLE_DESCRIPTIONS_FR covers every self-signup role", () => {
    for (const r of SELF_SIGNUP_ROLES) {
      expect(ROLE_DESCRIPTIONS_FR[r].label).toBeTruthy();
      expect(ROLE_DESCRIPTIONS_FR[r].blurb).toBeTruthy();
    }
  });
});

describe("RegisterSchema role hardening", () => {
  const base = {
    full_name: "Test User",
    email: "test@example.com",
    password: "Abcdefghi1",
    locale: "fr" as const,
  };

  it.each([...SELF_SIGNUP_ROLES])("accepts role=%s", (role: string) => {
    expect(RegisterSchema.safeParse({ ...base, role }).success).toBe(true);
  });

  it("rejects role=ADMIN", () => {
    const r = RegisterSchema.safeParse({ ...base, role: "ADMIN" });
    expect(r.success).toBe(false);
  });

  it("rejects role=PRESIDENT (unknown enum value)", () => {
    const r = RegisterSchema.safeParse({ ...base, role: "PRESIDENT" });
    expect(r.success).toBe(false);
  });
});
