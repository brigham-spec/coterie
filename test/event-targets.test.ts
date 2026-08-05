import { describe, expect, it } from "vitest";

import {
  computeEventTargets,
  type ComputeTargetsInput,
} from "@/lib/event-targets";

// Unit tests for the PURE Find-Targets graph scorer (slice S10b). No DB: the
// action assembles the inputs; this guards the edge detection, dedup, scoring,
// and ordering. Company ids are the graph nodes; the invited set is who's already
// on the guest list.

const CAND = "11111111-0000-0000-0000-000000000000";
const CAND2 = "22222222-0000-0000-0000-000000000000";
const GUEST = "aaaaaaaa-0000-0000-0000-000000000000";
const GUEST2 = "bbbbbbbb-0000-0000-0000-000000000000";
const CONTACT = "cccccccc-0000-0000-0000-000000000000";

function baseInput(over: Partial<ComputeTargetsInput> = {}): ComputeTargetsInput {
  return {
    invited: [{ companyId: GUEST, name: "Guest Co", referredById: null }],
    candidates: [
      {
        companyId: CAND,
        contactId: CONTACT,
        contactName: "Ada Byron",
        orgName: "Candidate Co",
        referredById: null,
      },
    ],
    intros: [],
    projectLinks: [],
    ...over,
  };
}

describe("computeEventTargets", () => {
  it("returns nothing when a candidate has no connection to any guest", () => {
    expect(computeEventTargets(baseInput())).toEqual([]);
  });

  it("scores an active introduction to an invited guest (strength 3)", () => {
    const out = computeEventTargets(
      baseInput({
        intros: [{ aCompanyId: CAND, bCompanyId: GUEST, status: "made" }],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      companyId: CAND,
      contactId: CONTACT,
      name: "Ada Byron",
      org: "Candidate Co",
      strength: 3,
    });
    expect(out[0].edges).toEqual([
      { type: "intro", label: "Introduced to Guest Co (Made)" },
    ]);
  });

  it("ignores terminal (dormant / value_created) introductions", () => {
    expect(
      computeEventTargets(
        baseInput({
          intros: [{ aCompanyId: CAND, bCompanyId: GUEST, status: "dormant" }],
        }),
      ),
    ).toEqual([]);
  });

  it("scores a shared project (strength 3)", () => {
    const out = computeEventTargets(
      baseInput({
        projectLinks: [
          { projectId: "p1", projectName: "Riverfront", companyId: CAND },
          { projectId: "p1", projectName: "Riverfront", companyId: GUEST },
        ],
      }),
    );
    expect(out[0].strength).toBe(3);
    expect(out[0].edges).toEqual([
      { type: "project", label: "Shared project: Riverfront with Guest Co" },
    ]);
  });

  it("scores referrals in both directions (strength 2 each)", () => {
    // Candidate was referred by a guest, and the candidate referred a second guest.
    const out = computeEventTargets({
      invited: [
        { companyId: GUEST, name: "Guest Co", referredById: null },
        { companyId: GUEST2, name: "Second Guest", referredById: CAND },
      ],
      candidates: [
        {
          companyId: CAND,
          contactId: CONTACT,
          contactName: "Ada Byron",
          orgName: "Candidate Co",
          referredById: GUEST,
        },
      ],
      intros: [],
      projectLinks: [],
    });
    expect(out[0].strength).toBe(4);
    expect(out[0].edges).toEqual([
      { type: "referral", label: "Referred by Guest Co" },
      { type: "referral", label: "Referred Second Guest" },
    ]);
  });

  it("dedups repeated intros to the same guest but sums distinct edge types", () => {
    const out = computeEventTargets(
      baseInput({
        intros: [
          { aCompanyId: CAND, bCompanyId: GUEST, status: "made" },
          { aCompanyId: GUEST, bCompanyId: CAND, status: "connected" },
        ],
        projectLinks: [
          { projectId: "p1", projectName: "Riverfront", companyId: CAND },
          { projectId: "p1", projectName: "Riverfront", companyId: GUEST },
        ],
      }),
    );
    // One intro edge (deduped by guest) + one project edge = 3 + 3.
    expect(out[0].edges.filter((e) => e.type === "intro")).toHaveLength(1);
    expect(out[0].strength).toBe(6);
  });

  it("sorts strongest first", () => {
    const out = computeEventTargets({
      invited: [{ companyId: GUEST, name: "Guest Co", referredById: null }],
      candidates: [
        {
          companyId: CAND,
          contactId: CONTACT,
          contactName: "Weak",
          orgName: "Weak Co",
          referredById: GUEST, // referral only → 2
        },
        {
          companyId: CAND2,
          contactId: "dddddddd-0000-0000-0000-000000000000",
          contactName: "Strong",
          orgName: "Strong Co",
          referredById: null,
        },
      ],
      intros: [{ aCompanyId: CAND2, bCompanyId: GUEST, status: "made" }], // 3
      projectLinks: [],
    });
    expect(out.map((s) => s.companyId)).toEqual([CAND2, CAND]);
  });

  it("never suggests an already-invited company", () => {
    const out = computeEventTargets({
      invited: [{ companyId: GUEST, name: "Guest Co", referredById: null }],
      candidates: [
        {
          companyId: GUEST,
          contactId: CONTACT,
          contactName: "Already In",
          orgName: "Guest Co",
          referredById: null,
        },
      ],
      intros: [{ aCompanyId: GUEST, bCompanyId: GUEST, status: "made" }],
      projectLinks: [],
    });
    expect(out).toEqual([]);
  });
});
