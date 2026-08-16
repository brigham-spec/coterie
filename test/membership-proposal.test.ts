import { describe, expect, it } from "vitest";

import {
  buildProposalContext,
  parseMembershipProposal,
  type MembershipProposalInput,
} from "@/lib/membership-proposal";

// Unit test for the PURE proposal-context builder + parser (knowledge layer, Step 2).
// buildProposalContext guards the grounding block the model reads: present fields
// appear, absent/empty fields are omitted, offered packages fold in with price +
// included services, and the collateral block appears only when non-empty.
// parseMembershipProposal guards the model's structured output: the prose fields are
// read and recommendedPackage collapses to null unless it exactly matches a supplied
// package name (no invented packages). No DB, no Anthropic.

const full: MembershipProposalInput = {
  orgName: "Hudson Valley EDC",
  userName: "Alex",
  company: {
    name: "Acme Mills",
    status: "prospect",
    industry: "Manufacturing",
    lookingFor: "a capital partner",
    canOffer: "warehouse space",
    notes: "Expanding the Kingston site.",
    contacts: [
      { name: "Jane Doe", title: "CFO" },
      { name: "Sam Poe", title: null },
    ],
  },
  packages: [
    {
      name: "Director",
      annualPrice: 25000,
      summary: "Top-tier access",
      includedServices: ["Board seat", "Quarterly briefings"],
    },
    {
      name: "Advisory",
      annualPrice: null,
      summary: "",
      includedServices: [],
    },
  ],
  grounding: "[Pitch deck] Overview\nWe connect founders to capital.",
};

describe("buildProposalContext", () => {
  it("includes present company fields", () => {
    const out = buildProposalContext(full);
    expect(out).toContain("ORGANIZATION: Hudson Valley EDC");
    expect(out).toContain("PROSPECT COMPANY: Acme Mills");
    expect(out).toContain("STATUS: prospect");
    expect(out).toContain("INDUSTRY: Manufacturing");
    expect(out).toContain("LOOKING FOR: a capital partner");
    expect(out).toContain("CAN OFFER: warehouse space");
    expect(out).toContain("NOTES: Expanding the Kingston site.");
    expect(out).toContain("CONTACTS: Jane Doe (CFO), Sam Poe");
  });

  it("omits absent optional fields", () => {
    const bare = buildProposalContext({
      ...full,
      company: {
        name: "Bare Co",
        status: "prospect",
        industry: null,
        lookingFor: null,
        canOffer: null,
        notes: null,
        contacts: [],
      },
    });
    expect(bare).not.toContain("INDUSTRY:");
    expect(bare).not.toContain("LOOKING FOR:");
    expect(bare).not.toContain("CONTACTS:");
  });

  it("renders packages with price, custom pricing, and included services", () => {
    const out = buildProposalContext(full);
    expect(out).toContain("MEMBERSHIP PACKAGES ON OFFER");
    expect(out).toContain("Director ($25,000/yr)");
    expect(out).toContain("includes: Board seat, Quarterly briefings");
    expect(out).toContain("Advisory (custom pricing)");
  });

  it("includes the collateral block only when grounding is non-empty", () => {
    const withGround = buildProposalContext(full);
    expect(withGround).toContain("ORGANIZATION COLLATERAL");
    expect(withGround).toContain("We connect founders to capital.");

    const without = buildProposalContext({ ...full, grounding: "" });
    expect(without).not.toContain("ORGANIZATION COLLATERAL");
  });

  it("omits the packages block when none are offered", () => {
    const out = buildProposalContext({ ...full, packages: [] });
    expect(out).not.toContain("MEMBERSHIP PACKAGES ON OFFER");
  });
});

describe("parseMembershipProposal", () => {
  const names = new Set(["Director", "Advisory"]);

  it("reads the prose fields and a valid recommended package", () => {
    const raw = JSON.stringify({
      positioning: "We build the region.",
      valueProposition: "You gain capital access.",
      recommendedPackage: "Director",
      packageRationale: "Best fit for scale.",
      closing: "Let's talk.",
    });
    const doc = parseMembershipProposal(raw, names);
    expect(doc.positioning).toBe("We build the region.");
    expect(doc.valueProposition).toBe("You gain capital access.");
    expect(doc.recommendedPackage).toBe("Director");
    expect(doc.packageRationale).toBe("Best fit for scale.");
    expect(doc.closing).toBe("Let's talk.");
  });

  it("collapses an invented recommended package to null", () => {
    const raw = JSON.stringify({
      positioning: "p",
      valueProposition: "v",
      recommendedPackage: "Platinum",
      packageRationale: "r",
      closing: "c",
    });
    expect(parseMembershipProposal(raw, names).recommendedPackage).toBeNull();
  });

  it("treats a null recommended package as null", () => {
    const raw = JSON.stringify({
      positioning: "p",
      valueProposition: "v",
      recommendedPackage: null,
      packageRationale: "",
      closing: "c",
    });
    expect(parseMembershipProposal(raw, names).recommendedPackage).toBeNull();
  });

  it("tolerates prose wrapped around the JSON", () => {
    const raw = 'Here you go:\n{"positioning":"p","valueProposition":"v"}\nThanks!';
    const doc = parseMembershipProposal(raw, names);
    expect(doc.positioning).toBe("p");
    expect(doc.valueProposition).toBe("v");
  });

  it("returns an empty proposal on non-JSON garbage", () => {
    const doc = parseMembershipProposal("no json here", names);
    expect(doc.positioning).toBe("");
    expect(doc.valueProposition).toBe("");
    expect(doc.recommendedPackage).toBeNull();
  });
});
