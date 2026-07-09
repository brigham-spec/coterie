// New Connections Detected — pure helpers (ported from the prototype's
// detectUnmatchedParticipants / inferOrgName / inferPersonName / renderUnmatchedPanel).
// No I/O, no secrets, no tenant context: the sync and the dashboard both feed it
// rows they already loaded withOrg, so this can never reach across silos and the
// inference + grouping rules stay unit-testable without a database or Fireflies.
//
// Design (matches the prototype): only ORG-affiliated strangers are worth surfacing.
// Generic mailbox providers (gmail, yahoo, …) don't identify an organization, so
// attendees on those domains are skipped at capture time — the sync uses
// isGenericDomain for that decision.

// Personal mailbox providers — an address here tells us nothing about an org, so
// these are never captured as "new connections".
const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "comcast.net",
  "verizon.net",
  "att.net",
]);

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

// Domain slice of an email ("" when there is no usable "@domain").
export function extractDomain(email: string | null | undefined): string {
  const e = normalizeEmail(email);
  const at = e.indexOf("@");
  if (at === -1) return "";
  return e.slice(at + 1);
}

export function isGenericDomain(domain: string): boolean {
  return GENERIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

// Best-guess person name from an email prefix ("jane.doe@…" -> "Jane Doe").
// Used only as a fallback when the attendee carried no display name.
export function inferPersonName(email: string | null | undefined): string {
  const prefix = normalizeEmail(email).split("@")[0] ?? "";
  return prefix
    .replace(/[._\-+]/g, " ")
    .replace(/\d+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

// Compound-domain words that read better as separate title-cased tokens.
const ORG_WORD_SEGMENTS = [
  "architecture",
  "international",
  "technologies",
  "technology",
  "associates",
  "foundation",
  "consulting",
  "development",
  "management",
  "solutions",
  "properties",
  "resources",
  "institute",
  "industries",
  "ventures",
  "advisors",
  "services",
  "partners",
  "strategies",
  "projects",
  "capital",
  "housing",
  "network",
  "realty",
  "health",
  "group",
  "trust",
  "works",
  "bank",
  "fund",
];
const ORG_SMALL_WORDS = new Set(["of", "and", "the", "at", "in", "for", "by"]);

// Best-guess org name from a domain ("hudsonvalleypartners.com" -> "Hudsonvalley
// Partners"). Deterministic and imperfect by design — it is a starting label the
// operator edits when they promote the connection, not authoritative data.
export function inferOrgName(domain: string): string {
  const base = (domain.split(".")[0] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (base === "") return "";
  let spaced = base;
  for (const w of ORG_WORD_SEGMENTS) spaced = spaced.split(w).join(` ${w} `);
  const words = spaced.split(/\s+/).filter(Boolean);
  return words
    .map((w, i) => {
      if (ORG_SMALL_WORDS.has(w) && i > 0) return w;
      // All-consonant or very short tokens read as acronyms (llc, nyc, hvedc).
      if (!/[aeiou]/.test(w) || w.length <= 3) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

// A single detected person, shaped for the dashboard panel.
export type ConnectionRow = {
  id: string;
  email: string;
  domain: string;
  inferredName: string | null;
  inferredOrg: string | null;
  seenCount: number;
  lastMeetingTitle: string | null;
};

// Detected people clustered under one inferred organization (email domain).
export type ConnectionGroup = {
  domain: string;
  orgName: string;
  totalSeen: number;
  people: ConnectionRow[];
};

// Group detected people by email domain -> inferred org, then order the most
// active connections first (total meeting appearances, then group size, then
// name). Mirrors the prototype's domain grouping + sort.
export function groupConnections(rows: ConnectionRow[]): ConnectionGroup[] {
  const byDomain = new Map<string, ConnectionRow[]>();
  for (const r of rows) {
    const list = byDomain.get(r.domain);
    if (list) list.push(r);
    else byDomain.set(r.domain, [r]);
  }

  const groups: ConnectionGroup[] = [];
  for (const [domain, people] of byDomain) {
    people.sort(
      (a, b) => b.seenCount - a.seenCount || a.email.localeCompare(b.email),
    );
    const orgName =
      people.find((p) => p.inferredOrg && p.inferredOrg.trim() !== "")
        ?.inferredOrg ?? inferOrgName(domain);
    const totalSeen = people.reduce((sum, p) => sum + p.seenCount, 0);
    groups.push({ domain, orgName: orgName || domain, totalSeen, people });
  }

  groups.sort(
    (a, b) =>
      b.totalSeen - a.totalSeen ||
      b.people.length - a.people.length ||
      a.orgName.localeCompare(b.orgName),
  );
  return groups;
}
