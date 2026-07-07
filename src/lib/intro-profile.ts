import type { IntroCompanyProfile } from "@/lib/intro-engine";

// Shared shaping for the introduction engine (slice 11.4c). Both the per-member
// scan (companies/[id]) and the proactive network scan (dashboard) load companies
// with the same relations and reduce them to the terse IntroCompanyProfile the
// model reasons over. Kept here — not in a route's actions file — so neither
// feature imports the other's server module. Pure data mapping (no DB, no secrets).

// Prisma `include` for the relations a profile needs. `as const` so the keys are
// literal (Prisma infers the exact selected shape).
export const introProfileInclude = {
  contacts: {
    orderBy: { name: "asc" },
    select: { name: true, title: true, isPrimary: true },
  },
  projectLinks: {
    orderBy: { role: "asc" },
    include: { project: { select: { name: true, stage: true } } },
  },
} as const;

// The structural subset of a company row we actually read. A findMany/findUnique
// with introProfileInclude returns a superset of this, so it maps cleanly.
export type CompanyWithProfile = {
  id: string;
  name: string;
  status: string;
  industry: string | null;
  tier: string | null;
  lookingFor: string | null;
  canOffer: string | null;
  networkTags: string[];
  counties: string[];
  contacts: Array<{ name: string; title: string | null; isPrimary: boolean }>;
  projectLinks: Array<{ role: string; project: { name: string; stage: string } }>;
};

export function toIntroProfile(c: CompanyWithProfile): IntroCompanyProfile {
  const primary = c.contacts.find((p) => p.isPrimary) ?? c.contacts[0] ?? null;
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    industry: c.industry,
    tier: c.tier,
    lookingFor: c.lookingFor,
    canOffer: c.canOffer,
    networkTags: c.networkTags,
    counties: c.counties,
    primaryContact: primary
      ? { name: primary.name, title: primary.title }
      : null,
    projects: c.projectLinks.map((l) => ({
      name: l.project.name,
      stage: l.project.stage,
      role: l.role,
    })),
  };
}
