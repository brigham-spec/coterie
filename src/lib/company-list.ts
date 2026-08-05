// Companies list-view intelligence (slice S11a, ported from the prototype's
// member-row badges, Coterie.html ~L4308-4320). Pure, DB-free derivations the
// companies table renders per row: how stale the last contact is (color bucket),
// how many open action items are attributed to a company, and how many
// introductions it's a party to. The page loads the rows withOrg and hands them
// here so the thresholds and attribution stay unit-tested without a database.

const DAY = 86_400_000;

// The companies-table sort options — one source shared by the filter's <select>
// (the labels) and the page's sort switch (the values), so they can't drift apart.
export type CompanySort = "name" | "value" | "recent" | "actions";
export const COMPANY_SORT_OPTIONS: { value: CompanySort; label: string }[] = [
  { value: "name", label: "Name (A–Z)" },
  { value: "value", label: "Value (high–low)" },
  { value: "recent", label: "Last contact" },
  { value: "actions", label: "Open actions" },
];

// Last-contact staleness bucket — red past 90 days, amber past 60, green when
// fresh, and "none" when there's no recorded contact. Mirrors the dashboard's
// Needs-a-Call coloring (>90d red) extended with the prototype's 60-day amber.
export type StaleTone = "fresh" | "warm" | "stale" | "none";

export function staleTone(date: Date | null, now: Date): StaleTone {
  if (date == null) return "none";
  const days = Math.floor((now.getTime() - date.getTime()) / DAY);
  if (days > 90) return "stale";
  if (days > 60) return "warm";
  return "fresh";
}

// An action item reduced to how it attributes to a company: a manual commitment
// carries companyId directly; a "they owe" item is attributed through the owing
// contact's company. Exactly one path applies (companyId wins if both present).
export type ActionAttrRow = {
  companyId: string | null;
  ownerContact: { companyId: string } | null;
};

export function tallyOpenActionsByCompany(
  rows: ActionAttrRow[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const companyId = row.companyId ?? row.ownerContact?.companyId ?? null;
    if (companyId != null)
      counts.set(companyId, (counts.get(companyId) ?? 0) + 1);
  }
  return counts;
}

// An introduction reduced to its two parties' companies. A company is credited
// once per intro even if (degenerately) both parties share it.
export type IntroAttrRow = {
  partyA: { companyId: string };
  partyB: { companyId: string };
};

export function tallyIntrosByCompany(rows: IntroAttrRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const ids =
      row.partyA.companyId === row.partyB.companyId
        ? [row.partyA.companyId]
        : [row.partyA.companyId, row.partyB.companyId];
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
