// Email Intelligence pure logic (slice 11.12). A Zapier zap has Claude analyse
// each inbound email and append a row to a published Google Sheet; the sync pulls
// that sheet's CSV and this module turns the raw text into typed rows and matches
// each one to a company. No I/O here — the fetch lives in the server-only seam
// (@/lib/email-sync) so this stays unit-testable and reusable.

export type EmailRow = {
  /// thread_id from the sheet, or a date+from_email fallback — the dedupe key.
  externalKey: string;
  emailDate: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  /// Claude's guessed contact / org, used only for fuzzy matching (not stored).
  memberMatch: string;
  orgMatch: string;
  summary: string;
  projects: string;
  actionItems: string;
  sentiment: string;
};

export type MatchCompany = {
  id: string;
  name: string;
  contactEmails: string[];
  contactNames: string[];
};

// Reject anything that isn't a Google-published CSV URL before the server fetches
// it — a plain host allowlist that closes the SSRF door the sheet URL would open.
export function isPublishedSheetUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.hostname === "docs.google.com";
}

// A single-pass RFC-4180-ish CSV parser: quoted fields may contain commas,
// newlines, and "" escapes. Returns a grid of raw cell strings (untrimmed).
function parseCsvGrid(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\r") {
      // swallow — a lone or CRLF carriage return outside quotes
    } else {
      cell += ch;
    }
  }
  // Flush the trailing cell/row (files often omit a final newline).
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z_]/g, "");
}

// Parse the synced sheet: normalise headers, map each data row by column name,
// drop fully-blank rows, and derive a stable dedupe key (thread_id, else
// date+from_email).
export function parseEmailSheet(csv: string): EmailRow[] {
  const grid = parseCsvGrid(csv);
  if (grid.length < 2) return [];

  const headers = grid[0].map((h) => normalizeHeader(h.trim()));
  const out: EmailRow[] = [];
  const seen = new Set<string>();

  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const get = (name: string) => {
      const idx = headers.indexOf(name);
      return idx === -1 ? "" : (cells[idx] ?? "").trim();
    };

    const emailDate = get("date");
    const fromName = get("from_name");
    const fromEmail = get("from_email");
    const subject = get("subject");
    const memberMatch = get("member_match");
    const orgMatch = get("org_match");
    const summary = get("summary");
    const projects = get("projects");
    const actionItems = get("action_items");
    const sentiment = get("sentiment");
    const threadId = get("thread_id");

    // Skip rows Zapier left empty or that are just trailing blanks.
    if (
      fromEmail === "" &&
      subject === "" &&
      summary === "" &&
      fromName === ""
    )
      continue;

    const externalKey = threadId || `${emailDate}_${fromEmail}`;
    if (externalKey === "_" || seen.has(externalKey)) continue;
    seen.add(externalKey);

    out.push({
      externalKey,
      emailDate,
      fromName,
      fromEmail,
      subject,
      memberMatch,
      orgMatch,
      summary,
      projects,
      actionItems,
      sentiment,
    });
  }

  return out;
}

// Assign an email to at most one company. Rules run in priority order (an exact
// contact-email hit beats any fuzzy signal), each scanning every company, so the
// result is deterministic regardless of company load order. Returns null when
// nothing matches — the caller stores those in the Unmatched bucket.
export function matchEmailToCompany(
  row: EmailRow,
  companies: MatchCompany[],
): string | null {
  const fromEmail = row.fromEmail.toLowerCase();
  const orgMatch = row.orgMatch.toLowerCase();
  const memberMatch = row.memberMatch.toLowerCase();

  // 1. Exact from-address match against a known contact.
  if (fromEmail !== "") {
    for (const c of companies) {
      if (c.contactEmails.some((e) => e !== "" && e.toLowerCase() === fromEmail))
        return c.id;
    }
  }

  const orgWordsFor = (c: MatchCompany) =>
    c.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, " ")
      .split(" ")
      .filter((w) => w.length > 4);

  // 2. A distinctive word from the company name appears in the sender address.
  if (fromEmail !== "") {
    for (const c of companies) {
      if (orgWordsFor(c).some((w) => fromEmail.includes(w))) return c.id;
    }
  }

  // 3. …or in Claude's guessed org.
  if (orgMatch !== "") {
    for (const c of companies) {
      if (orgWordsFor(c).some((w) => orgMatch.includes(w))) return c.id;
    }
  }

  // 4. A contact's name word appears in Claude's guessed contact.
  if (memberMatch !== "") {
    for (const c of companies) {
      const nameWords = c.contactNames
        .flatMap((n) => n.toLowerCase().split(" "))
        .filter((n) => n.length > 2);
      if (nameWords.some((n) => memberMatch.includes(n))) return c.id;
    }
  }

  return null;
}
