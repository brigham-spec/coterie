// Lightweight, advisory duplicate detection for the create forms. Pure (no
// server-only / client-only, no IO) so it's unit-testable and can run in the
// browser against page data that's already loaded. These power a NON-BLOCKING
// pre-submit warning — the user can always add anyway — not a DB constraint.

// Trim + lowercase + collapse internal whitespace so "Acme  Corp " and
// "acme corp" compare equal.
export function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export type ExistingCompany = { id: string; name: string };

// A company duplicate is another company in the org with the same normalized
// name. Blank names never match.
export function findCompanyDuplicate(
  name: string,
  existing: readonly ExistingCompany[],
): ExistingCompany | null {
  const norm = normalizeName(name);
  if (norm === "") return null;
  return existing.find((c) => normalizeName(c.name) === norm) ?? null;
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
// that, the same normalized name at the same company. Blank email skips the
// email check; blank name skips the name check.
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

  const norm = normalizeName(candidate.name);
  if (norm === "") return null;
  return (
    existing.find(
      (c) => c.companyId === candidate.companyId && normalizeName(c.name) === norm,
    ) ?? null
  );
}
