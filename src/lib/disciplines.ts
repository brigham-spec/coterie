// Canonical project-team discipline vocabulary (slice 11.4c, ported from the
// prototype's roleLabels + disciplineMap). PURE — no DB, no secrets. These are the
// professional roles a real-estate/development project staffs; each value matches a
// ProjectLink.role, so an "open role" on a project is simply a discipline with no
// link. `keywords` are lowercase substrings used to heuristically decide whether a
// company can plausibly fill the role (matched against its industry / canOffer /
// tags / primary contact title) — the same signal the prototype used to seed the
// candidate pool before the model ranks it.

export type Discipline = {
  /// snake_case, matches ProjectLink.role.
  value: string;
  label: string;
  /// lowercase substrings that signal capability for this discipline.
  keywords: string[];
};

export const DISCIPLINES: readonly Discipline[] = [
  { value: "architect", label: "Architect", keywords: ["architect", "architecture"] },
  { value: "design_architect", label: "Design Architect", keywords: ["design architect"] },
  {
    value: "civil_engineer",
    label: "Civil Engineer",
    keywords: ["civil engineer", "site engineer", "civil engineering"],
  },
  {
    value: "structural_engineer",
    label: "Structural Engineer",
    keywords: ["structural"],
  },
  {
    value: "mep_engineer",
    label: "MEP Engineer",
    keywords: ["mep", "mechanical", "electrical", "plumbing"],
  },
  {
    value: "environmental",
    label: "Environmental Eng.",
    keywords: ["environmental"],
  },
  {
    value: "landscape_architect",
    label: "Landscape Architect",
    keywords: ["landscape architect"],
  },
  {
    value: "land_use_attorney",
    label: "Land Use Attorney",
    keywords: ["attorney", "lawyer", "land use", "counsel"],
  },
  {
    value: "general_contractor",
    label: "General Contractor",
    keywords: ["general contractor", "construction management", "construction manager"],
  },
  { value: "owners_rep", label: "Owner's Rep", keywords: ["owner's rep", "owner rep"] },
  {
    value: "interior_designer",
    label: "Interior Designer",
    keywords: ["interior design"],
  },
  {
    value: "lender",
    label: "Lender",
    keywords: ["lender", "lending", "finance", "bank"],
  },
  {
    value: "bridge_lender",
    label: "Bridge Lender",
    keywords: ["bridge lend", "bridge loan", "bridge financ"],
  },
  {
    value: "equity_partner",
    label: "Equity Partner",
    keywords: ["equity", "private equity", "investor", "family office"],
  },
  {
    value: "tax_credit_consultant",
    label: "Tax Credit Consultant",
    keywords: ["tax credit", "historic tax", "new market"],
  },
  {
    value: "historic_preservation",
    label: "Historic Preservation",
    keywords: ["historic preservation", "historic"],
  },
  {
    value: "hospitality_operator",
    label: "Hospitality Operator",
    keywords: ["hospitality", "hotel operat"],
  },
  { value: "surveyor", label: "Surveyor", keywords: ["survey"] },
  { value: "traffic_engineer", label: "Traffic Engineer", keywords: ["traffic"] },
  {
    value: "permitting_consultant",
    label: "Permitting Consultant",
    keywords: ["permitting", "expediter", "expeditor"],
  },
];

const BY_VALUE = new Map(DISCIPLINES.map((d) => [d.value, d]));

/// Look up a discipline by its role value; undefined for a non-discipline role
/// (e.g. the base `developer`/`site_host`/`agency`/`advisor` participation roles).
export function getDiscipline(value: string): Discipline | undefined {
  return BY_VALUE.get(value);
}

/// PURE: the disciplines a project has NOT yet staffed — every discipline whose
/// value is absent from the set of roles already linked to the project. Base
/// participation roles that aren't disciplines simply don't appear here.
export function openRoles(filledRoles: Iterable<string>): Discipline[] {
  const filled = new Set(filledRoles);
  return DISCIPLINES.filter((d) => !filled.has(d.value));
}

/// PURE: does a company's free-text signals plausibly indicate it can fill this
/// discipline? A case-insensitive substring match against the discipline keywords.
export function companyMatchesDiscipline(
  discipline: Discipline,
  signals: string,
): boolean {
  const hay = signals.toLowerCase();
  return discipline.keywords.some((k) => hay.includes(k));
}
