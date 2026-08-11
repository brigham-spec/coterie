import { describe, expect, it } from "vitest";

import { assertAdminRole, ForbiddenError } from "@/lib/auth";

// The role gate behind requireAdmin, which fronts every destructive action
// (deleting a company/contact/project/introduction/meeting, voiding a bill).
// Only our "admin" role passes; everything else must throw ForbiddenError.

describe("assertAdminRole", () => {
  it("passes for the admin role", () => {
    expect(() => assertAdminRole("admin")).not.toThrow();
  });

  it("throws ForbiddenError for staff", () => {
    expect(() => assertAdminRole("staff")).toThrow(ForbiddenError);
  });

  it("throws for any unrecognized role (fails closed)", () => {
    expect(() => assertAdminRole("")).toThrow(ForbiddenError);
    expect(() => assertAdminRole("owner")).toThrow(ForbiddenError);
  });
});
