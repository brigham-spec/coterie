// Value Created rollup (slice 11.8, ported from the prototype's valueCreatedView).
// PURE — no DB, no server-only: the page loads projects + companies inside withOrg
// (RLS-scoped) and hands plain typed rows here; this module does the attribution
// math so it's exhaustively unit-testable. economic_impact and services arrive as
// untyped Json from Postgres, so the coercers below are defensive: anything missing
// or malformed reads as zero / inactive rather than throwing.

import { TERMINAL_STAGES } from "@/lib/project-stages";

// ── Numbers ────────────────────────────────────────────────────────────────
// Coerce an unknown Json value to a finite number, else 0. Accepts numeric strings
// (economic_impact is hand-entered / migrated, so values may arrive as strings).
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function record(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

// ── Economic impact ─────────────────────────────────────────────────────────
// Aggregated regional impact for one project. All monetary fields in dollars.
export type EconomicImpact = {
  permanentJobs: number;
  constructionJobs: number;
  constructionCost: number;
  taxAbatementValue: number;
  grantsSecured: number;
};

export const ZERO_IMPACT: EconomicImpact = {
  permanentJobs: 0,
  constructionJobs: 0,
  constructionCost: 0,
  taxAbatementValue: 0,
  grantsSecured: 0,
};

const SECURED_GRANT_STATUSES = new Set(["awarded", "received"]);

/// Defensively coerce a project's economic_impact Json into a typed EconomicImpact.
/// Tax abatement counts only when active; grants count only once secured
/// (Awarded / Received). Missing / malformed shapes read as zero.
export function parseEconomicImpact(raw: unknown): EconomicImpact {
  const o = record(raw);
  const abatement = record(o.taxAbatement);
  const taxAbatementValue = abatement.active ? num(abatement.totalValue) : 0;

  const grants = Array.isArray(o.grants) ? o.grants : [];
  const grantsSecured = grants.reduce<number>((sum, g) => {
    const grant = record(g);
    return SECURED_GRANT_STATUSES.has(str(grant.status).toLowerCase())
      ? sum + num(grant.amount)
      : sum;
  }, 0);

  return {
    permanentJobs: num(o.permanentJobs),
    constructionJobs: num(o.constructionJobs),
    constructionCost: num(o.constructionCost),
    taxAbatementValue,
    grantsSecured,
  };
}

function addImpact(a: EconomicImpact, b: EconomicImpact): EconomicImpact {
  return {
    permanentJobs: a.permanentJobs + b.permanentJobs,
    constructionJobs: a.constructionJobs + b.constructionJobs,
    constructionCost: a.constructionCost + b.constructionCost,
    taxAbatementValue: a.taxAbatementValue + b.taxAbatementValue,
    grantsSecured: a.grantsSecured + b.grantsSecured,
  };
}

export function impactIsEmpty(i: EconomicImpact): boolean {
  return (
    i.permanentJobs === 0 &&
    i.constructionJobs === 0 &&
    i.constructionCost === 0 &&
    i.taxAbatementValue === 0 &&
    i.grantsSecured === 0
  );
}

// ── Services (IDA advisory + capital placement) ─────────────────────────────
export type ServiceLine = {
  active: boolean;
  status: string;
  serviceFee: number;
  valueSecured: number;
};

export type CompanyServices = { ida: ServiceLine | null; capital: ServiceLine | null };

function parseServiceLine(raw: unknown): ServiceLine | null {
  const o = record(raw);
  if (!o.active) return null;
  return {
    active: true,
    status: str(o.status),
    serviceFee: num(o.serviceFee),
    // IDA tracks valueSecured; capital tracks amountPlaced — surface whichever is set.
    valueSecured: num(o.valueSecured) || num(o.amountPlaced),
  };
}

/// Defensively coerce a company's services Json into its active IDA / capital lines.
/// An inactive or absent line reads as null.
export function parseServices(raw: unknown): CompanyServices {
  const o = record(raw);
  return { ida: parseServiceLine(o.ida), capital: parseServiceLine(o.capital) };
}

// ── Project + company inputs (shaped by the page from withOrg reads) ────────
export type ValueProject = {
  id: string;
  name: string;
  stage: string;
  county: string | null;
  description: string | null;
  value: number | null;
  realizedValue: number | null;
  memberNames: string[];
  stageHistory: string[];
  economicImpact: EconomicImpact;
};

export type ValueCompany = {
  id: string;
  name: string;
  contactName: string | null;
  industry: string | null;
  annualValue: number;
  services: CompanyServices;
};

// ── Rollup ──────────────────────────────────────────────────────────────────
/// Attributed value for one project: what was realized if known, else the pipeline
/// estimate, else zero.
export function facilitatedValue(p: ValueProject): number {
  return p.realizedValue ?? p.value ?? 0;
}

export function isActiveStage(stage: string): boolean {
  return !TERMINAL_STAGES.includes(stage);
}

export type ValueSummary = {
  facilitatedValue: number;
  memberConnectedCount: number;
  multiMemberCount: number;
  serviceFeeRevenue: number;
  /// facilitatedValue / totalArr — how much regional value each membership dollar
  /// moved. Null when either side is zero (no meaningful ratio yet).
  networkMultiplier: number | null;
  activePipelineValue: number;
  totalArr: number;
  impact: EconomicImpact;
  multiMemberDeals: ValueProject[];
  memberConnectedPipeline: ValueProject[];
  activeServices: ValueCompany[];
};

/// Compute the full Value Created rollup from this tenant's projects + companies.
/// Member-connected = at least one participant company; multi-member = 2+ (the
/// clearest attribution signal). Facilitated value sums member-connected projects;
/// the active pipeline sums the non-terminal ones.
export function computeValueSummary(
  projects: ValueProject[],
  companies: ValueCompany[],
): ValueSummary {
  const memberConnected = projects.filter((p) => p.memberNames.length >= 1);
  const multiMember = projects.filter((p) => p.memberNames.length >= 2);

  const byFacilitatedDesc = (a: ValueProject, b: ValueProject) =>
    facilitatedValue(b) - facilitatedValue(a);

  const facilitated = memberConnected.reduce(
    (sum, p) => sum + facilitatedValue(p),
    0,
  );

  const activePipelineValue = memberConnected
    .filter((p) => isActiveStage(p.stage))
    .reduce((sum, p) => sum + facilitatedValue(p), 0);

  const serviceFeeRevenue = companies.reduce((sum, c) => {
    const ida = c.services.ida?.serviceFee ?? 0;
    const capital = c.services.capital?.serviceFee ?? 0;
    return sum + ida + capital;
  }, 0);

  const totalArr = companies.reduce((sum, c) => sum + c.annualValue, 0);

  const impact = projects.reduce(
    (acc, p) => addImpact(acc, p.economicImpact),
    ZERO_IMPACT,
  );

  const activeServices = companies.filter(
    (c) => c.services.ida !== null || c.services.capital !== null,
  );

  const memberConnectedPipeline = memberConnected
    .filter((p) => p.memberNames.length === 1 && isActiveStage(p.stage))
    .sort(byFacilitatedDesc);

  return {
    facilitatedValue: facilitated,
    memberConnectedCount: memberConnected.length,
    multiMemberCount: multiMember.length,
    serviceFeeRevenue,
    networkMultiplier:
      totalArr > 0 && facilitated > 0 ? facilitated / totalArr : null,
    activePipelineValue,
    totalArr,
    impact,
    multiMemberDeals: [...multiMember].sort(byFacilitatedDesc),
    memberConnectedPipeline,
    activeServices,
  };
}
