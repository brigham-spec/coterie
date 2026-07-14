import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonObject } from "@/lib/json-extract";

// Document-analysis engine (gap-audit cluster E, ported from the prototype's
// showAnalyzeDocModal, Coterie.html:9120). Given an uploaded PDF — an offering
// memo, pitch deck, or investment summary — extract the intro-engine-critical
// profile fields (what they're looking for / can offer, geography, deal size,
// agency contacts) plus a note to append and a plain-English description of the
// document. Like the other AI seams this is server-only: the prompt, model, and
// output shape live here and the PDF bytes are sent as an Anthropic document
// block, so the API key never reaches the browser. The result is EPHEMERAL —
// only the fields the operator explicitly selects are written (via
// applyDocumentIntel).

// The company the document is being read for, plus its current field values so
// the model can tell what's already known and surface genuinely new detail.
export type DocumentCompanyContext = {
  fileName: string;
  orgName: string;
  contactName: string;
  industry: string;
  lookingFor: string;
  canOffer: string;
  counties: string;
  dealSize: string;
  agencyContacts: string;
};

// The extracted intelligence. Every field is a string; "" means "nothing found".
// `docSummary` is a one-line description of the document (display-only, not written).
export type DocumentIntel = {
  docSummary: string;
  lookingFor: string;
  canOffer: string;
  counties: string;
  dealSize: string;
  agencyContacts: string;
  notesAppend: string;
};

// PURE: coerce any JSON value to a trimmed, bounded string. The model is told to
// use "" for empty, but defends against the literal string "null" too.
function str(value: unknown, max = 400): string {
  if (typeof value !== "string") return "";
  const t = value.trim();
  return t.toLowerCase() === "null" ? "" : t.slice(0, max);
}

/// PURE: parse the model's raw completion into structured intel. Pulls the JSON
/// object out of any fence/prose and coerces each field. Returns null when
/// nothing usable came back (every writable field empty) so the caller can treat
/// it as "no structured data found".
export function parseDocumentIntel(raw: string): DocumentIntel | null {
  const json = extractJsonObject(raw);
  if (json == null) return null;

  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const intel: DocumentIntel = {
    docSummary: str(obj.docSummary, 300),
    lookingFor: str(obj.lookingFor, 200),
    canOffer: str(obj.canOffer, 200),
    counties: str(obj.counties, 200),
    dealSize: str(obj.dealSize, 120),
    agencyContacts: str(obj.agencyContacts, 200),
    notesAppend: str(obj.notesAppend, 500),
  };

  const empty =
    intel.lookingFor === "" &&
    intel.canOffer === "" &&
    intel.counties === "" &&
    intel.dealSize === "" &&
    intel.agencyContacts === "" &&
    intel.notesAppend === "";
  if (empty) return null;
  return intel;
}

/// PURE: the user prompt handed alongside the document block. Gives the member's
/// current field values as context, then asks for the exact JSON we consume.
export function buildDocumentPrompt(context: DocumentCompanyContext): string {
  return `Extract structured CRM intelligence from the attached document for a member profile.

Member Organization: ${context.orgName}
${context.contactName ? `Primary Contact: ${context.contactName}\n` : ""}Document: ${context.fileName}

Current — Looking For: ${context.lookingFor || "(empty)"}
Current — Can Offer: ${context.canOffer || "(empty)"}
Current — Counties: ${context.counties || "(empty)"}
Current — Deal Size: ${context.dealSize || "(empty)"}
Current — Agency Contacts: ${context.agencyContacts || "(empty)"}

Extract only what the document clearly states. Quote real numbers, percentages, project names, and geographies. Prefer "" over inventing anything.

Return ONLY a valid JSON object (no markdown, no prose):
{"docSummary":"1-2 sentence plain-English description of what this document is","lookingFor":"what this org needs — capital amount, type, timeline. Specific. \"\" if not found","canOffer":"what this org offers — returns, asset class, track record. Specific. \"\" if not found","counties":"geographic focus areas named in the document. \"\" if not found","dealSize":"typical deal or check size. \"\" if not found","agencyContacts":"government or agency relationships mentioned. \"\" if not found","notesAppend":"2-3 sentence summary of the document and its key terms to append to notes. \"\" if nothing significant"}`;
}

const SYSTEM_PROMPT = `You are a CRM intelligence analyst reading a member's document (offering memo, pitch deck, or investment summary). Return ONLY a single JSON object with the requested keys. Extract only information explicitly present in the document — never invent, infer, or hallucinate. An empty string is always better than invented content.`;

/// Extract profile intelligence from a base64-encoded PDF. Ephemeral — nothing
/// is stored; the operator reviews and applies selected fields. Returns null when
/// the model gives nothing usable.
export async function generateDocumentIntel(
  context: DocumentCompanyContext,
  base64Pdf: string,
): Promise<DocumentIntel | null> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64Pdf,
            },
          },
          { type: "text", text: buildDocumentPrompt(context) },
        ],
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parseDocumentIntel(text);
}
