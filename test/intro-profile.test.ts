import { describe, it, expect } from "vitest";

import { toIntroProfile, type CompanyWithProfile } from "@/lib/intro-profile";

// Guards that the company's SECONDARY profile (synthesized from affiliations +
// documents) flows through toIntroProfile into the IntroCompanyProfile the engine
// reasons over — so the engine can weight it below the primary signal.

function company(over: Partial<CompanyWithProfile>): CompanyWithProfile {
  return {
    id: "c1",
    name: "Acme Mills",
    status: "member",
    industry: "Manufacturing",
    tier: null,
    lookingFor: "Capital",
    canOffer: "Precision machining",
    secondaryIndustry: null,
    secondaryCanOffer: null,
    secondaryLookingFor: null,
    networkTags: [],
    counties: [],
    contacts: [],
    projectLinks: [],
    ...over,
  };
}

describe("toIntroProfile", () => {
  it("passes the secondary triplet through to the intro profile", () => {
    const p = toIntroProfile(
      company({
        secondaryIndustry: "Logistics",
        secondaryCanOffer: "Fleet capacity",
        secondaryLookingFor: "Cold-storage partners",
      }),
    );
    expect(p.secondaryIndustry).toBe("Logistics");
    expect(p.secondaryCanOffer).toBe("Fleet capacity");
    expect(p.secondaryLookingFor).toBe("Cold-storage partners");
    // Primary signal is unchanged alongside it.
    expect(p.lookingFor).toBe("Capital");
    expect(p.canOffer).toBe("Precision machining");
  });

  it("keeps a missing secondary profile null (not surfaced)", () => {
    const p = toIntroProfile(company({}));
    expect(p.secondaryIndustry).toBeNull();
    expect(p.secondaryCanOffer).toBeNull();
    expect(p.secondaryLookingFor).toBeNull();
  });
});
