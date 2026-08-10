import { afterEach, describe, expect, it } from "vitest";

import type { OrgContext } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";

// The platform-operator gate — the ONLY thing standing between a tenant admin and
// the module toggles. It must fail closed (unset env → nobody), be case- and
// whitespace-insensitive on the email match, and never treat a blank user email
// as a match. Pure env-allowlist logic, so no DB.

const ORIGINAL = process.env.PLATFORM_ADMIN_EMAILS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
  else process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL;
});

function ctx(userEmail: string): OrgContext {
  return { userEmail } as OrgContext;
}

describe("isPlatformAdmin", () => {
  it("fails closed when the allowlist is unset", () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    expect(isPlatformAdmin(ctx("you@coterie.io"))).toBe(false);
  });

  it("fails closed when the allowlist is empty", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "";
    expect(isPlatformAdmin(ctx("you@coterie.io"))).toBe(false);
  });

  it("matches a listed email case- and whitespace-insensitively", () => {
    process.env.PLATFORM_ADMIN_EMAILS = " You@Coterie.io , ops@coterie.io ";
    expect(isPlatformAdmin(ctx("you@coterie.io"))).toBe(true);
    expect(isPlatformAdmin(ctx("  OPS@CoteriE.io "))).toBe(true);
  });

  it("rejects an email not on the list", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "you@coterie.io";
    expect(isPlatformAdmin(ctx("admin@hvedc.com"))).toBe(false);
  });

  it("never treats a blank user email as a match", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "you@coterie.io,";
    expect(isPlatformAdmin(ctx(""))).toBe(false);
    expect(isPlatformAdmin(ctx("   "))).toBe(false);
  });
});
