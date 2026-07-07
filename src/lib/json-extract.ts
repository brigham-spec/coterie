// Shared, PURE helper for the AI engines. Models are asked for a bare JSON array
// but sometimes wrap it in prose or a markdown fence; this pulls out the first
// top-level array so each engine's parser can validate the contents. Kept in its
// own tiny module (no secrets, no server-only) so both the introduction engine
// and the open-roles engine reuse one implementation rather than duplicating it.
export function extractJsonArray(raw: string): string | null {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}
