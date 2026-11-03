import { describe, expect, test } from "vitest";

import {
  categorizeIndustry,
  OTHER_INDUSTRY_CATEGORY,
} from "@/lib/industry-categories";

// Pure unit test for the Companies-list industry rollup. Proves granular free-text
// values collapse into the right broad bucket, that ordering resolves the obvious
// cross-bucket collisions, and that unmatched/empty input falls to "Other".
describe("categorizeIndustry", () => {
  test("rolls granular construction values into Construction", () => {
    expect(categorizeIndustry("Construction Manager")).toBe("Construction");
    expect(categorizeIndustry("General Contractor")).toBe("Construction");
    expect(categorizeIndustry("Commercial Roofing")).toBe("Construction");
  });

  test("groups the obvious buckets", () => {
    expect(categorizeIndustry("Commercial Real Estate")).toBe("Real Estate");
    expect(categorizeIndustry("Private Equity")).toBe("Finance");
    expect(categorizeIndustry("Software Development")).toBe("Technology");
    expect(categorizeIndustry("Architecture")).toBe("Architecture & Engineering");
  });

  test("is case-insensitive", () => {
    expect(categorizeIndustry("SOFTWARE")).toBe("Technology");
    expect(categorizeIndustry("manufacturing")).toBe("Manufacturing");
  });

  test("order resolves cross-bucket collisions", () => {
    // Finance before Consulting: "advisory" alone is Consulting, but "financial"
    // wins first.
    expect(categorizeIndustry("Financial Advisory")).toBe("Finance");
    // Healthcare before Technology: the bare "tech" keyword must not swallow it.
    expect(categorizeIndustry("Biotech")).toBe("Healthcare & Life Sciences");
    // Education before Technology, same reason.
    expect(categorizeIndustry("EdTech")).toBe("Education");
  });

  test("falls back to Other for unmatched or empty input", () => {
    expect(categorizeIndustry("Underwater Basket Weaving")).toBe(
      OTHER_INDUSTRY_CATEGORY,
    );
    expect(categorizeIndustry("")).toBe(OTHER_INDUSTRY_CATEGORY);
    expect(categorizeIndustry("   ")).toBe(OTHER_INDUSTRY_CATEGORY);
  });
});
