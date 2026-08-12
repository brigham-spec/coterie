import { TERMINAL_INTRO_STAGES, getIntroStageDef } from "@/lib/intro-stages";

// Find-Targets connection graph (slice S10b, ported from the prototype's
// scanForTargets, Coterie.html:8425). Pure, DB-free scoring: given who's already
// on an event's guest list, surface network companies connected to those guests
// through the relationship graph — a warm reason to invite them too. The
// prototype scored four edge types; prod has no intro-obligation model, so three
// map: an existing introduction, a shared project, and a referral (either
// direction). Each edge carries a weight; a candidate's strength is the sum, and
// suggestions sort strongest-first. The action assembles the inputs withOrg-scoped
// and calls compute here, keeping the graph logic testable without a database.

export const TARGET_EDGE_STRENGTH = {
  intro: 3,
  project: 3,
  referral: 2,
} as const;

export type TargetEdgeType = keyof typeof TARGET_EDGE_STRENGTH;

export type TargetEdge = { type: TargetEdgeType; label: string };

export type TargetSuggestion = {
  companyId: string;
  contactId: string;
  name: string; // the contact we'd add as the invitee
  org: string | null; // the candidate's company
  edges: TargetEdge[];
  strength: number;
};

// A company already on the guest list (via a network contact), with its referrer so
// the referral edge can point either way.
export type InvitedCompany = {
  companyId: string;
  name: string;
  referredById: string | null;
};

// A network company eligible to suggest, plus the one contact we'd invite.
export type TargetCandidate = {
  companyId: string;
  contactId: string;
  contactName: string;
  orgName: string | null;
  referredById: string | null;
};

// An introduction reduced to the two parties' companies and its status.
export type TargetIntro = {
  aCompanyId: string;
  bCompanyId: string;
  status: string;
};

// One company's participation in a project.
export type TargetProjectLink = {
  projectId: string;
  projectName: string;
  companyId: string;
};

export type ComputeTargetsInput = {
  invited: InvitedCompany[];
  candidates: TargetCandidate[];
  intros: TargetIntro[];
  projectLinks: TargetProjectLink[];
};

export function computeEventTargets(
  input: ComputeTargetsInput,
): TargetSuggestion[] {
  const { invited, candidates, intros, projectLinks } = input;

  const invitedIds = new Set(invited.map((c) => c.companyId));
  const invitedName = new Map(invited.map((c) => [c.companyId, c.name] as const));

  // Group project links by project so a shared project is a single scan.
  const linksByProject = new Map<string, TargetProjectLink[]>();
  for (const l of projectLinks) {
    const arr = linksByProject.get(l.projectId);
    if (arr) arr.push(l);
    else linksByProject.set(l.projectId, [l]);
  }

  const results: TargetSuggestion[] = [];

  for (const cand of candidates) {
    // An already-invited company is never its own suggestion.
    if (invitedIds.has(cand.companyId)) continue;
    const edges: TargetEdge[] = [];

    // Edge 1 — an active introduction linking this company to an invited guest.
    // Dormant/concluded intros are dropped (mirrors the prototype). One edge per
    // invited company so a pair introduced twice doesn't double-count.
    const introCited = new Set<string>();
    for (const intro of intros) {
      if (TERMINAL_INTRO_STAGES.includes(intro.status)) continue;
      const otherId =
        intro.aCompanyId === cand.companyId
          ? intro.bCompanyId
          : intro.bCompanyId === cand.companyId
            ? intro.aCompanyId
            : null;
      if (otherId === null || !invitedIds.has(otherId) || introCited.has(otherId))
        continue;
      introCited.add(otherId);
      edges.push({
        type: "intro",
        label: `Introduced to ${invitedName.get(otherId) ?? "a guest"} (${getIntroStageDef(intro.status).label})`,
      });
    }

    // Edge 2 — a project this company shares with an invited guest. Unlike the
    // intro loop above (which dedups per invited company), distinct shared
    // projects intentionally each add an edge: two projects with a guest is two
    // genuine reasons to invite. Links are grouped by project, so a candidate
    // appearing twice within one project can't double-count.
    for (const links of linksByProject.values()) {
      if (!links.some((l) => l.companyId === cand.companyId)) continue;
      const shared = links.find(
        (l) => l.companyId !== cand.companyId && invitedIds.has(l.companyId),
      );
      if (!shared) continue;
      edges.push({
        type: "project",
        label: `Shared project: ${shared.projectName} with ${invitedName.get(shared.companyId) ?? "a guest"}`,
      });
    }

    // Edge 3 — a referral in either direction between this company and a guest.
    if (cand.referredById !== null && invitedIds.has(cand.referredById))
      edges.push({
        type: "referral",
        label: `Referred by ${invitedName.get(cand.referredById) ?? "a guest"}`,
      });
    for (const inv of invited)
      if (inv.referredById === cand.companyId)
        edges.push({ type: "referral", label: `Referred ${inv.name}` });

    if (edges.length === 0) continue;
    const strength = edges.reduce(
      (sum, e) => sum + TARGET_EDGE_STRENGTH[e.type],
      0,
    );
    results.push({
      companyId: cand.companyId,
      contactId: cand.contactId,
      name: cand.contactName,
      org: cand.orgName,
      edges,
      strength,
    });
  }

  // Strongest connection first; a stable name tie-break keeps output deterministic.
  results.sort(
    (a, b) =>
      b.strength - a.strength ||
      (a.org ?? a.name).localeCompare(b.org ?? b.name),
  );
  return results;
}
