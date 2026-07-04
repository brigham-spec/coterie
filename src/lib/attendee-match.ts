// Attendee -> contact matcher (build item 6, spec §3.10). Pure: no I/O, no
// secrets, no tenant context. The caller supplies contacts/companies it already
// loaded withOrg, so this can never reach across silos, and the match rules stay
// unit-testable without a database or Fireflies.
//
// Philosophy (spec §3.10): only an exact email match is trustworthy enough to
// auto-confirm. Every weaker signal is recorded with confidence < 1 and left
// unconfirmed so a human verifies it — we never silently merge a stranger into
// a known contact. Weaker methods only fire when they resolve to EXACTLY ONE
// contact; an ambiguous signal yields no match rather than a guess.

export type MatchContact = {
  id: string;
  name: string;
  email: string | null;
  companyId: string;
};

export type MatchCompany = {
  id: string;
  emailDomain: string | null;
};

export type AttendeeInput = {
  email: string | null;
  displayName: string | null;
  name: string | null;
};

export type MatchMethod = "email" | "domain" | "display_name" | "surname";

export type AttendeeMatch = {
  contactId: string;
  matchMethod: MatchMethod;
  confidence: number;
};

// Only exact-email matches clear this bar and are auto-confirmed; anything below
// is surfaced for human confirmation.
export const CONFIRM_THRESHOLD = 1;

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function surname(fullName: string): string {
  const parts = norm(fullName).split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

export function matchAttendee(
  attendee: AttendeeInput,
  contacts: MatchContact[],
  companies: MatchCompany[],
): AttendeeMatch | null {
  const email = norm(attendee.email);
  const name = norm(attendee.displayName) || norm(attendee.name);

  // 1) Exact email — the only trustworthy signal (confidence 1.0).
  if (email !== "") {
    const hit = contacts.find((c) => norm(c.email) === email);
    if (hit != null)
      return { contactId: hit.id, matchMethod: "email", confidence: 1 };
  }

  // 2) Full display-name equality, when unambiguous (0.6). Names collide across
  //    firms, so this is surfaced for confirmation, not merged.
  if (name !== "") {
    const byName = contacts.filter((c) => norm(c.name) === name);
    if (byName.length === 1)
      return {
        contactId: byName[0].id,
        matchMethod: "display_name",
        confidence: 0.6,
      };
  }

  // 3) Email domain -> a company we know, when that company holds exactly one
  //    contact (so the firm alone identifies the person) (0.5).
  const at = email.indexOf("@");
  if (at !== -1) {
    const domain = email.slice(at + 1);
    if (domain !== "") {
      const companyIds = new Set(
        companies
          .filter((co) => norm(co.emailDomain) === domain)
          .map((co) => co.id),
      );
      if (companyIds.size > 0) {
        const inCompanies = contacts.filter((c) => companyIds.has(c.companyId));
        if (inCompanies.length === 1)
          return {
            contactId: inCompanies[0].id,
            matchMethod: "domain",
            confidence: 0.5,
          };
      }
    }
  }

  // 4) Surname, when exactly one contact shares it (0.3). The weakest signal.
  if (name !== "") {
    const sn = surname(name);
    if (sn !== "") {
      const bySurname = contacts.filter((c) => surname(c.name) === sn);
      if (bySurname.length === 1)
        return {
          contactId: bySurname[0].id,
          matchMethod: "surname",
          confidence: 0.3,
        };
    }
  }

  return null;
}
