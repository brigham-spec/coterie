// Shared FormData field parsers for server actions. These guard the two failure
// modes a raw `new Date(formData.get(...))` silently allows through: an empty
// field (→ null) and a malformed string (→ an Invalid Date that Prisma would
// persist as a null/garbage @db.Date). Both anchors below reject the malformed
// case with a clear per-field message instead of writing a bad row.

// Optional date field (YYYY-MM-DD) → Date, or null when the field is empty.
// A present-but-unparseable value throws rather than persisting an Invalid Date.
export function optionalDate(formData: FormData, key: string): Date | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error(`${key} is not a valid date`);
  return d;
}

// Required date field (YYYY-MM-DD) → Date. Throws when empty or unparseable.
export function requiredDate(formData: FormData, key: string): Date {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") throw new Error(`${key} is required`);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error(`${key} is not a valid date`);
  return d;
}

const HTTP_URL = /^https?:\/\//i;

// An explicit URL scheme prefix (e.g. "javascript:", "https:"). A scheme-less
// value — a bare domain like "acme.com" or a relative path — has no match; those
// are the common way a user types a website and are harmless as an href.
const EXPLICIT_SCHEME = /^([a-z][a-z0-9+.-]*):/i;

// Guards a user-entered value bound for an anchor `href` against the stored-XSS
// vector: a script-executing scheme (`javascript:`, `data:`, `vbscript:`, …).
// http(s) and scheme-less values (bare domains / relative paths) pass through
// unchanged; any other explicit scheme throws with a clear per-field message.
export function assertHttpUrl(value: string, key: string): string {
  const scheme = value.match(EXPLICIT_SCHEME)?.[1]?.toLowerCase();
  if (scheme !== undefined && scheme !== "http" && scheme !== "https")
    throw new Error(`${key} must be an http(s) URL`);
  return value;
}

// Optional URL field → the guarded value, or null when empty. A dangerous scheme
// throws (see assertHttpUrl).
export function optionalUrl(formData: FormData, key: string): string | null {
  const v = assertHttpUrl(String(formData.get(key) ?? "").trim(), key);
  return v === "" ? null : v;
}

// Normalizes an externally-sourced URL for safe href rendering: returns it only
// when it's a real http(s) URL, else null. Stricter than assertHttpUrl (external
// data has no reason to be a bare domain) and never throws — suited to background
// syncs where one bad value must not abort the batch.
export function httpUrlOrNull(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return HTTP_URL.test(v) ? v : null;
}
