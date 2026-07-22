// HVEDC services on a project (projects-module parity; ported from the prototype's
// "HVEDC Services on this Project" section, Coterie.html:17707). The project's
// hv_services Json column holds one line per service key — what HVEDC is doing for
// the project and the fee it earns — and those active fees flow into Revenue
// reporting (prototype `projSvcFees`, Coterie.html:3589). PURE — no DB, no
// server-only; the coercers below read anything missing / malformed as empty.

import { numFromJson, recordFromJson, strFromJson } from "@/lib/json-coerce";

export type HvServiceKey =
  | "capitalSourcing"
  | "idaNavigation"
  | "realEstateSales"
  | "grantCfa"
  | "other";

export type HvServiceDef = { key: HvServiceKey; label: string; short: string };

// The five service lines, in display order. `short` is the compact badge label
// (prototype's Capital / IDA / RE Sales / Grant / Svc).
export const HV_SERVICE_DEFS: readonly HvServiceDef[] = [
  { key: "capitalSourcing", label: "Capital Sourcing", short: "Capital" },
  { key: "idaNavigation", label: "IDA Navigation", short: "IDA" },
  { key: "realEstateSales", label: "Real Estate Sales", short: "RE Sales" },
  { key: "grantCfa", label: "Grant / CFA", short: "Grant" },
  { key: "other", label: "Other Services", short: "Svc" },
];

// Where the engagement stands, and where its fee stands.
export const SERVICE_STATUSES = ["Active", "In Progress", "Completed", "On Hold"] as const;
export const FEE_STATUSES = ["Proposed", "Invoiced", "Paid", "Recurring"] as const;

const SERVICE_KEY_SET = new Set<string>(HV_SERVICE_DEFS.map((d) => d.key));
const SERVICE_STATUS_SET = new Set<string>(SERVICE_STATUSES);
const FEE_STATUS_SET = new Set<string>(FEE_STATUSES);

export function isHvServiceKey(v: string): v is HvServiceKey {
  return SERVICE_KEY_SET.has(v);
}

// Write-boundary guards: an out-of-vocab status is dropped to "" rather than persisted.
export function normalizeServiceStatus(v: string): string {
  return SERVICE_STATUS_SET.has(v) ? v : "";
}

export function normalizeFeeStatus(v: string): string {
  return FEE_STATUS_SET.has(v) ? v : "";
}

export type HvServiceLine = {
  active: boolean;
  status: string;
  description: string;
  fee: number;
  feeStatus: string;
};

export type HvService = HvServiceDef & { line: HvServiceLine };

/// Defensively coerce a project's hv_services Json into all five typed lines (in
/// display order). A missing / malformed line reads as inactive with empty fields.
export function parseHvServices(raw: unknown): HvService[] {
  const o = recordFromJson(raw);
  return HV_SERVICE_DEFS.map((def) => {
    const s = recordFromJson(o[def.key]);
    return {
      ...def,
      line: {
        active: s.active === true,
        status: strFromJson(s.status),
        description: strFromJson(s.description),
        fee: numFromJson(s.fee),
        feeStatus: strFromJson(s.feeStatus),
      },
    };
  });
}

/// Sum the fees of the active service lines — the project's service-fee revenue
/// (prototype `projSvcFees`). Fees are in dollars.
export function sumActiveServiceFees(services: HvService[]): number {
  return services.reduce(
    (sum, s) => (s.line.active ? sum + s.line.fee : sum),
    0,
  );
}
