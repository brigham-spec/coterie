// Shared, PURE helpers for the AI engines. Models are asked for bare JSON but
// sometimes wrap it in prose or a markdown fence, and often append a trailing
// sentence ("Let me know if you need anything else!"). A naive first-open /
// last-close slice swallows that trailing prose — and any stray brace inside it —
// producing an unparseable string that drops otherwise-usable output. Instead we
// scan for the FIRST balanced top-level object/array with a quote-aware depth
// counter, so trailing text after the JSON is ignored. Kept in its own tiny
// module (no secrets, no server-only) so every engine reuses one implementation.
//
// A model can also run out of output budget (max_tokens) mid-array, truncating
// the final element and leaving the array unbalanced. A strict balanced scan then
// returns nothing and every completed element is lost. So extractJsonArray falls
// back to recovering the elements that WERE finished before the cutoff.

// Scan from the first `open` delimiter and return the substring up to its
// matching `close`, honoring nested delimiters and string literals (so braces or
// brackets inside a quoted value never move the depth). Returns null when there
// is no opener or the structure never balances.
function firstBalanced(raw: string, open: string, close: string): string | null {
  const start = raw.indexOf(open);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }

  return null;
}

// Recover each COMPLETE top-level object from a (possibly truncated) array, in
// order. Quote/escape/nesting aware like firstBalanced — a `}` inside a string or
// a nested object never closes an element. Returns the raw object substrings
// (already valid JSON). Only object elements are recovered, which is every
// engine's shape (an array of objects).
function recoverArrayObjects(raw: string): string[] {
  const start = raw.indexOf("[");
  if (start === -1) return [];

  const out: string[] = [];
  let depth = 0;
  let objStart = -1;
  let inString = false;
  let escaped = false;

  for (let i = start + 1; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && objStart !== -1) {
          out.push(raw.slice(objStart, i + 1));
          objStart = -1;
        }
      }
    }
  }

  return out;
}

// Pull out the first balanced top-level array so each engine's parser can
// validate the contents. When the array never closes — the common case of a model
// hitting its max_tokens mid-array — recover the elements that WERE completed and
// re-wrap them as a valid array, rather than dropping the entire (otherwise
// usable) response. Returns null only when nothing usable is present.
export function extractJsonArray(raw: string): string | null {
  const balanced = firstBalanced(raw, "[", "]");
  if (balanced !== null) return balanced;

  const recovered = recoverArrayObjects(raw);
  return recovered.length > 0 ? `[${recovered.join(",")}]` : null;
}

// Same idea for engines that ask for a single JSON object (e.g. the why-join
// pitch): pull out the first balanced top-level object.
export function extractJsonObject(raw: string): string | null {
  return firstBalanced(raw, "{", "}");
}
