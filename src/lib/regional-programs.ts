// Regional program library (ported from the prototype's DEFAULT_REGIONAL_PROGRAMS,
// Coterie.html:10011). A curated set of Hudson Valley county/municipal funding
// programs that the AI Suggest engine injects into its prompt based on the
// project's county — so the model always evaluates the known-local programs (who
// applies, eligibility, max amount) instead of only surfacing generic state/
// federal ones. Static data, no persistence: the prototype let the operator edit
// this list in localStorage, but the production seam is read-only for now.

export type RegionalProgram = {
  id: string;
  name: string;
  agency: string;
  /// County name(s) or region this program serves; matched loosely against the
  /// project's county (plus the region-wide "mid-hudson"/"region" catch-alls).
  jurisdiction: string;
  type: string;
  /// Who files the application — informs the AI's WHO-APPLIES guidance.
  applicant: "developer" | "municipality" | "either";
  maxAmount: string;
  eligibility: string;
  notes: string;
};

export const DEFAULT_REGIONAL_PROGRAMS: readonly RegionalProgram[] = [
  {
    id: "rp_uchaf",
    name: "Ulster County Housing Action Fund (HAF)",
    agency: "Ulster County Planning Dept",
    jurisdiction: "Ulster",
    type: "Grant",
    applicant: "developer",
    maxAmount: "$300k-$1M per project",
    eligibility:
      "Affordable rental and ownership housing in Ulster County. Units must serve households at or below 80% AMI. 50-year affordability covenant. Annual competitive rounds.",
    notes:
      "Developer/nonprofit applies directly to Ulster County. Frog Alley received $380k in a prior round.",
  },
  {
    id: "rp_restore_ny",
    name: "Restore NY Communities Initiative",
    agency: "Empire State Development",
    jurisdiction: "Mid-Hudson Region",
    type: "Grant",
    applicant: "municipality",
    maxAmount: "Up to $2M per project",
    eligibility:
      "Rehabilitation or adaptive reuse of vacant, abandoned, or surplus commercial/industrial buildings. Former industrial sites converting to housing are strong candidates.",
    notes:
      "MUNICIPALITY MUST APPLY on behalf of the project - developer cannot apply directly. Developer approaches City of Kingston to sponsor the application. Annual ESD round.",
  },
  {
    id: "rp_main_street",
    name: "NY Main Street Program",
    agency: "HCR",
    jurisdiction: "Mid-Hudson Region",
    type: "Grant",
    applicant: "municipality",
    maxAmount: "Up to $500k per project",
    eligibility:
      "Commercial and mixed-use building rehabilitation in downtowns. Requires a commercial component. Upper-floor residential conversion eligible.",
    notes:
      "LEAD ORGANIZATION (municipality, LDC, or BID) applies - developer works through them. Frog Alley live-work retail units may create eligibility.",
  },
  {
    id: "rp_newburgh_cdbg",
    name: "City of Newburgh CDBG",
    agency: "City of Newburgh",
    jurisdiction: "Orange",
    type: "Grant",
    applicant: "municipality",
    maxAmount: "$50k-$500k per project",
    eligibility:
      "Direct HUD CDBG entitlement. LMI household benefit required. Housing and economic development within Newburgh city limits.",
    notes:
      "CITY controls the allocation - developer requests city support, city applies to HUD and allocates. Mike Oates has existing relationships here.",
  },
  {
    id: "rp_pok_cdbg",
    name: "City of Poughkeepsie CDBG",
    agency: "City of Poughkeepsie",
    jurisdiction: "Dutchess",
    type: "Grant",
    applicant: "municipality",
    maxAmount: "Varies",
    eligibility:
      "Direct HUD CDBG entitlement. LMI benefit required. Within Poughkeepsie city limits only.",
    notes:
      "CITY controls the CDBG allocation. Developer presents project to city - city is the applicant to HUD.",
  },
  {
    id: "rp_kingston_cdbg",
    name: "City of Kingston Housing Programs / Land Bank",
    agency: "City of Kingston",
    jurisdiction: "Ulster",
    type: "Grant",
    applicant: "municipality",
    maxAmount: "Varies by program",
    eligibility:
      "LMI housing and community development in Kingston. Kingston City Land Bank active on vacant/distressed sites.",
    notes:
      "CITY and Land Bank control these programs. Developer approaches city/Land Bank to request support - they are the applicant.",
  },
  {
    id: "rp_oc_ida",
    name: "Orange County IDA (OCIDA)",
    agency: "Orange County IDA",
    jurisdiction: "Orange",
    type: "Tax Benefit",
    applicant: "developer",
    maxAmount: "PILOT + sales tax exemption + MRT savings",
    eligibility:
      "Commercial, industrial, and mixed-use development in Orange County with economic development benefit.",
    notes: "Developer applies directly to IDA. Bill Fioravanti at OCIDA is key contact.",
  },
  {
    id: "rp_esd_discretionary",
    name: "ESD / REDC Discretionary Grants",
    agency: "Empire State Development",
    jurisdiction: "Mid-Hudson Region",
    type: "Grant",
    applicant: "either",
    maxAmount: "$100k to several million",
    eligibility:
      "Economic development projects with job creation or community benefit in the Mid-Hudson region. Applied through the annual CFA portal (CFA is the submission vehicle, not the funding source itself).",
    notes:
      "Can be developer-led or municipality-led. Municipal support letter strengthens applications. Annual fall round.",
  },
  {
    id: "rp_421p",
    name: "IDA 421-p PILOT",
    agency: "Local IDA + School Board",
    jurisdiction: "Ulster, Orange, Dutchess",
    type: "Tax Benefit",
    applicant: "developer",
    maxAmount: "Phased PILOT + sales tax savings on construction",
    eligibility:
      "Affordable housing where local IDA provides PILOT. REQUIRES school board opt-in - school board must voluntarily participate or school tax exemption cannot apply. Size-agnostic.",
    notes:
      "Developer applies to IDA directly. School board opt-in is prerequisite - Kingston School Board opt-in for Frog Alley is the current bottleneck.",
  },
];

/// PURE: the programs relevant to a project's county — those whose jurisdiction
/// matches the county name, plus the region-wide programs (mid-hudson / region).
/// Blank county yields nothing (mirrors the prototype's getRegionalProgramsForCounty).
export function getRegionalProgramsForCounty(
  county: string | null | undefined,
): RegionalProgram[] {
  if (!county) return [];
  const countyL = county.toLowerCase().trim();
  if (!countyL) return [];
  return DEFAULT_REGIONAL_PROGRAMS.filter((p) => {
    const j = p.jurisdiction.toLowerCase();
    return j.includes(countyL) || j.includes("mid-hudson") || j.includes("region");
  });
}
