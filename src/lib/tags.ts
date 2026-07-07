// Network tag vocabulary — the shared language for what a company needs and what
// it brings, plus what a contact IS. Ported from the prototype's ORG_TAGS /
// CONTACT_TAGS (Coterie.html §16001). Org tags live on Company.networkTags;
// contact tags on Contact.tags. This is pure data — a `tone` (mapped to a
// design-token family in the TagBadge primitive), never a raw color, so the
// palette stays centralized. No emoji (the prototype's icons are dropped in
// favor of clean text badges).

export type TagScope = "org" | "contact";
export type TagTone = "teal" | "gold" | "purple" | "red" | "slate";

export type TagDef = {
  key: string;
  label: string;
  tone: TagTone;
  scope: TagScope;
  desc: string;
};

export const ORG_TAGS: readonly TagDef[] = [
  {
    key: "seeking_equity",
    label: "Seeking Equity",
    tone: "teal",
    scope: "org",
    desc: "Actively seeking an equity partner or co-investor for a live project",
  },
  {
    key: "seeking_debt",
    label: "Seeking Financing",
    tone: "teal",
    scope: "org",
    desc: "Needs construction, bridge, or permanent debt financing",
  },
  {
    key: "capital_campaign",
    label: "Capital Campaign",
    tone: "gold",
    scope: "org",
    desc: "Running an active philanthropic or fundraising capital campaign",
  },
  {
    key: "capital_provider",
    label: "Capital Provider",
    tone: "teal",
    scope: "org",
    desc: "Source of capital — debt, equity, grants, or family office investment",
  },
  {
    key: "active_project",
    label: "Active Project",
    tone: "gold",
    scope: "org",
    desc: "Has a live project in active development, entitlement, or construction",
  },
  {
    key: "seeking_jv",
    label: "Seeking JV Partner",
    tone: "gold",
    scope: "org",
    desc: "Looking for a joint venture, co-development, or strategic development partner",
  },
  {
    key: "for_sale",
    label: "Asset for Sale",
    tone: "red",
    scope: "org",
    desc: "Entitled or improved asset available for acquisition or investment partnership",
  },
  {
    key: "ida_active",
    label: "IDA Active",
    tone: "purple",
    scope: "org",
    desc: "Currently navigating an IDA application, PILOT negotiation, or incentive process",
  },
  {
    key: "needs_advocacy",
    label: "Needs Advocacy",
    tone: "purple",
    scope: "org",
    desc: "Needs legislative, regulatory, or government agency relationship support",
  },
  {
    key: "hospitality_active",
    label: "Hospitality / Experience",
    tone: "teal",
    scope: "org",
    desc: "Operating or developing an active hospitality, dining, or experiential venue",
  },
  {
    key: "corporate_anchor",
    label: "Corporate Anchor",
    tone: "slate",
    scope: "org",
    desc: "Major employer or institutional anchor driving regional economic activity",
  },
];

export const CONTACT_TAGS: readonly TagDef[] = [
  {
    key: "decision_maker",
    label: "Decision Maker",
    tone: "teal",
    scope: "contact",
    desc: "Primary decision-maker for major transactions or organizational commitments",
  },
  {
    key: "hnw",
    label: "HNW / Philanthropist",
    tone: "teal",
    scope: "contact",
    desc: "High-net-worth individual or active philanthropist with giving capacity",
  },
  {
    key: "family_office",
    label: "Family Office",
    tone: "teal",
    scope: "contact",
    desc: "Represents a family office or private foundation investment vehicle",
  },
  {
    key: "lp_angel",
    label: "LP / Angel Investor",
    tone: "teal",
    scope: "contact",
    desc: "LP fund participant, angel investor, or private capital source",
  },
  {
    key: "board_candidate",
    label: "Board Candidate",
    tone: "purple",
    scope: "contact",
    desc: "Strong candidate for a board seat — experienced, connected, committed",
  },
  {
    key: "gov_official",
    label: "Gov / Agency",
    tone: "purple",
    scope: "contact",
    desc: "Elected official, government appointee, or agency director",
  },
];

const BY_KEY: ReadonlyMap<string, TagDef> = new Map(
  [...ORG_TAGS, ...CONTACT_TAGS].map((t) => [t.key, t]),
);

/// Resolve a tag key to its definition. Unknown keys (from evolving data) fall
/// back to a neutral slate badge carrying the raw key as its label.
export function getTagDef(key: string): TagDef {
  return (
    BY_KEY.get(key) ?? {
      key,
      label: key,
      tone: "slate",
      scope: "org",
      desc: "",
    }
  );
}
