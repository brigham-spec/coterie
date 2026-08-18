// Lightweight, advisory duplicate detection for the create forms. Pure (no
// server-only / client-only, no IO) so it's unit-testable and can run in the
// browser against page data that's already loaded. These power a NON-BLOCKING
// pre-submit warning — the user can always add anyway — not a DB constraint.

// Trim + lowercase + collapse internal whitespace so "Acme  Corp " and
// "acme corp" compare equal.
export function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function tokensOf(s: string): string[] {
  const norm = normalizeName(s);
  return norm === "" ? [] : norm.split(" ");
}

// Advisory "these look like the same thing" test. True when the two names are
// equal OR one's words are a full subset of the other's, so "DBI",
// "DBI Projects", and "DBI Projects Test" all flag against each other without
// needing an exact match. Blank names never match. This is intentionally loose
// (it only powers a non-blocking warning), catching the common case where a
// duplicate is entered as a longer/qualified version of an existing name.
export function namesLikelyMatch(a: string, b: string): boolean {
  const ta = tokensOf(a);
  const tb = tokensOf(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const largeSet = new Set(large);
  return small.every((t) => largeSet.has(t));
}

export type ExistingCompany = { id: string; name: string };

// A company duplicate is another company in the org whose name looks like the
// same thing (equal, or one name's words contained in the other's). Blank
// names never match.
export function findCompanyDuplicate(
  name: string,
  existing: readonly ExistingCompany[],
): ExistingCompany | null {
  if (normalizeName(name) === "") return null;
  return existing.find((c) => namesLikelyMatch(c.name, name)) ?? null;
}

export type ExistingContact = {
  id: string;
  name: string;
  companyId: string;
  email: string | null;
  companyName?: string;
};

// A contact duplicate is: an existing contact with the same email anywhere in
// the org (the strongest signal — email is a person's identity), or, failing
// that, a name that looks like the same person at the same company (equal, or
// one name's words contained in the other's). Blank email skips the email
// check; blank name skips the name check.
export function findContactDuplicate(
  candidate: { name: string; companyId: string; email: string | null },
  existing: readonly ExistingContact[],
): ExistingContact | null {
  const email = candidate.email ? candidate.email.trim().toLowerCase() : "";
  if (email !== "") {
    const byEmail = existing.find(
      (c) => c.email != null && c.email.trim().toLowerCase() === email,
    );
    if (byEmail) return byEmail;
  }

  if (normalizeName(candidate.name) === "") return null;
  return (
    existing.find(
      (c) =>
        c.companyId === candidate.companyId &&
        namesLikelyMatch(c.name, candidate.name),
    ) ?? null
  );
}
