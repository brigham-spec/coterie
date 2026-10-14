// Pure order reconciliation for the company-profile movable tiles. A saved order
// (from this browser's localStorage) is replayed against the cards actually
// present this render: saved ids that still exist keep their saved position,
// then any ids not in the saved list (new or newly-conditional cards) are
// appended in their natural order. So a stored layout never hides a card and
// never breaks when the card set changes.

export const CARD_ORDER_STORAGE_KEY = "coterie:card-order:company";

export function reconcileOrder(saved: string[], ids: string[]): string[] {
  const present = new Set(ids);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const id of saved) {
    if (present.has(id) && !seen.has(id)) {
      kept.push(id);
      seen.add(id);
    }
  }
  for (const id of ids) if (!seen.has(id)) kept.push(id);
  return kept;
}
