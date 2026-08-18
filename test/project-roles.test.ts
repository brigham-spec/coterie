import { describe, it, expect } from "vitest";

import {
  PROJECT_LINK_ROLE_GROUPS,
  isProjectLinkRole,
  projectLinkRoleLabel,
} from "@/lib/project-roles";
import { DISCIPLINES } from "@/lib/disciplines";

// Unit test for the PURE combined, grouped company↔project link role vocabulary.
// No DB, no secrets. Guards the two <optgroup> shape (Stakeholder vs Discipline),
// the dedupe of overlapping values (e.g. `lender`), the write-boundary guard, and
// the label helper's fallback for legacy/unknown roles.

describe("project link role vocabulary", () => {
  it("exposes exactly the Stakeholder and Discipline groups", () => {
    expect(PROJECT_LINK_ROLE_GROUPS.map((g) => g.label)).toEqual([
      "Stakeholder",
      "Discipline",
    ]);
  });

  it("keeps the five stakeholder roles", () => {
    const stakeholder = PROJECT_LINK_ROLE_GROUPS[0];
    expect(stakeholder.options.map((o) => o.value)).toEqual([
      "developer",
      "lender",
      "site_host",
      "agency",
      "advisor",
    ]);
  });

  it("draws disciplines from @/lib/disciplines, deduped against stakeholders", () => {
    const disciplineValues = PROJECT_LINK_ROLE_GROUPS[1].options.map(
      (o) => o.value,
    );
    // `lender` is a stakeholder role, so it must not repeat in the discipline group.
    expect(disciplineValues).not.toContain("lender");
    // Every discipline value that isn't a stakeholder role should be present.
    expect(disciplineValues).toContain("general_contractor");
    expect(disciplineValues).toContain("equity_partner");
    expect(disciplineValues).toEqual(
      DISCIPLINES.filter((d) => d.value !== "lender").map((d) => d.value),
    );
  });

  it("has no duplicate values across both groups", () => {
    const all = PROJECT_LINK_ROLE_GROUPS.flatMap((g) =>
      g.options.map((o) => o.value),
    );
    expect(new Set(all).size).toBe(all.length);
  });

  it("recognizes known roles and rejects unknown ones", () => {
    expect(isProjectLinkRole("developer")).toBe(true);
    expect(isProjectLinkRole("general_contractor")).toBe(true);
    expect(isProjectLinkRole("not_a_role")).toBe(false);
    expect(isProjectLinkRole("")).toBe(false);
  });

  it("labels known roles and humanizes unknown ones", () => {
    expect(projectLinkRoleLabel("site_host")).toBe("Site host");
    expect(projectLinkRoleLabel("general_contractor")).toBe(
      "General Contractor",
    );
    // Legacy/unknown value falls back to a readable humanized form.
    expect(projectLinkRoleLabel("some_old_role")).toBe("Some Old Role");
  });
});
