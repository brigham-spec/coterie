// Contacts list filtering (shared by the contacts page + its CSV export route).
// One source for the status tabs and the row filter so the page you're viewing
// and the file you export can never drift apart — the sibling of filterCompanies
// in company-list.ts. A contact's SEGMENT is its company's status, so the same
// member/partner/prospect/former tabs apply via companySegmentMatches.

import { companySegmentMatches } from "@/lib/company-list";

// The active contact filters, pre-resolved from the URL query string. `q` is
// already trimmed + lowercased; `company` is a company id ("" = all); `tag` is a
// contact-tag key ("" = all); `primaryOnly` keeps only each firm's main contact.
export type ContactFilter = {
  segment: string;
  q: string;
  company: string;
  tag: string;
  primaryOnly: boolean;
};

type FilterableContact = {
  name: string;
  title: string | null;
  email: string | null;
  companyId: string;
  companyName: string;
  companyStatus: string;
  tags: string[];
  isPrimary: boolean;
};

/// PURE: apply the active filters to a loaded contact set. Mirrors the contacts
/// page's in-memory predicate chain exactly so an export matches the view. The
/// segment is matched against the contact's COMPANY status (companySegmentMatches
/// treats an unknown key as "All").
export function filterContacts<T extends FilterableContact>(
  contacts: T[],
  f: ContactFilter,
): T[] {
  return contacts.filter((c) => {
    if (!companySegmentMatches(f.segment, c.companyStatus)) return false;
    if (
      f.q !== "" &&
      !c.name.toLowerCase().includes(f.q) &&
      !(c.title ?? "").toLowerCase().includes(f.q) &&
      !(c.email ?? "").toLowerCase().includes(f.q) &&
      !c.companyName.toLowerCase().includes(f.q)
    )
      return false;
    if (f.company !== "" && c.companyId !== f.company) return false;
    if (f.tag !== "" && !c.tags.includes(f.tag)) return false;
    if (f.primaryOnly && !c.isPrimary) return false;
    return true;
  });
}
