import { describe, it, expect } from "vitest";

import {
  HV_SERVICE_DEFS,
  isHvServiceKey,
  normalizeFeeStatus,
  normalizeServiceStatus,
  parseHvServices,
  sumActiveServiceFees,
} from "@/lib/hv-services";

// Unit test for the HVEDC-services PURE helpers (projects-module parity). Guards
// the defensive Json coercion (hv_services arrives untyped from Postgres), the
// active-fee sum that flows into Revenue reporting, and the write-boundary vocab
// normalizers.

describe("parseHvServices", () => {
  it("returns all five lines in display order, defaulting missing ones", () => {
    const parsed = parseHvServices({});
    expect(parsed.map((s) => s.key)).toEqual([
      "capitalSourcing",
      "idaNavigation",
      "realEstateSales",
      "grantCfa",
      "other",
    ]);
    for (const s of parsed) {
      expect(s.line).toEqual({
        active: false,
        status: "",
        description: "",
        fee: 0,
        feeStatus: "",
      });
    }
  });

  it("coerces a populated line, tolerating string fees", () => {
    const parsed = parseHvServices({
      capitalSourcing: {
        active: true,
        status: "Active",
        description: "Debt placement",
        fee: "25000",
        feeStatus: "Invoiced",
      },
    });
    const capital = parsed.find((s) => s.key === "capitalSourcing")!;
    expect(capital.line).toEqual({
      active: true,
      status: "Active",
      description: "Debt placement",
      fee: 25000,
      feeStatus: "Invoiced",
    });
  });

  it("reads a malformed / null column as all-empty lines", () => {
    expect(parseHvServices(null).every((s) => !s.line.active)).toBe(true);
    expect(parseHvServices("garbage").every((s) => !s.line.active)).toBe(true);
    expect(parseHvServices([1, 2]).every((s) => !s.line.active)).toBe(true);
  });
});

describe("sumActiveServiceFees", () => {
  it("sums only the fees of active lines", () => {
    const services = parseHvServices({
      capitalSourcing: { active: true, fee: 25000 },
      idaNavigation: { active: true, fee: 10000 },
      realEstateSales: { active: false, fee: 99999 },
      grantCfa: { active: true, fee: 0 },
    });
    expect(sumActiveServiceFees(services)).toBe(35000);
  });

  it("is zero when nothing is active", () => {
    expect(sumActiveServiceFees(parseHvServices({}))).toBe(0);
  });
});

describe("vocab guards", () => {
  it("recognizes the five service keys", () => {
    expect(HV_SERVICE_DEFS.every((d) => isHvServiceKey(d.key))).toBe(true);
    expect(isHvServiceKey("nope")).toBe(false);
  });

  it("drops out-of-vocab statuses to empty", () => {
    expect(normalizeServiceStatus("Active")).toBe("Active");
    expect(normalizeServiceStatus("bogus")).toBe("");
    expect(normalizeFeeStatus("Paid")).toBe("Paid");
    expect(normalizeFeeStatus("bogus")).toBe("");
  });
});
