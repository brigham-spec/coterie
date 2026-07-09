import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonArray } from "@/lib/json-extract";
import { EVENT_TYPES, getEventType, isEventType } from "@/lib/event-stages";

// Event-ideation engine (gap-audit cluster D, ported from the prototype's
// doGenerateEventSuggestions / buildEventContext, Coterie.html:7174). Given the
// tenant's network — its member companies (with what each seeks/offers and which
// have never been invited to anything), active projects, recent meeting
// intelligence, and past events — Claude proposes a handful of distinct events
// that would create genuine value RIGHT NOW, each with a datable "why now", a
// tiered invite list drawn from real members, and a concrete expected outcome.
//
// Like the other AI features this is the single server-only seam: prompt, model,
// and output shape live here so tenant data only leaves through a shape we
// control and the API key never reaches the browser. Ideas are grounded strictly
// in the supplied context — tier-1/2 guests must be real supplied members (any
// invented id is dropped), and results are EPHEMERAL (nothing is stored).

// One member company the ideation reasons over. `neverInvited` flags members who
// have never appeared on any event guest list — the engine is told to prioritise
// bringing them into the room.
export type IdeaMember = {
  companyId: string;
  name: string;
  industry: string | null;
  status: string;
  tags: string[];
  canOffer: string | null;
  lookingFor: string | null;
  neverInvited: boolean;
};

export type IdeaProject = {
  name: string;
  stage: string;
  type: string | null;
  county: string | null;
};

export type IdeaMeeting = {
  title: string;
  date: string | null;
  summary: string | null;
};

export type IdeaEventHistory = {
  name: string;
  type: string;
  date: string | null;
  theme: string | null;
  attended: number;
};

export type EventIdeasInput = {
  orgName: string;
  members: IdeaMember[];
  projects: IdeaProject[];
  recentMeetings: IdeaMeeting[];
  eventHistory: IdeaEventHistory[];
};

// A suggested guest drawn from the network. `companyId` is validated against the
// supplied roster; `name` is re-attached from that roster, never trusted from the
// model's output.
export type IdeaGuest = { companyId: string; name: string; why: string };

// A suggested guest NOT in the CRM (an external anchor or a prospect to recruit).
export type IdeaExternalGuest = { org: string; why: string; isProspect: boolean };

// A proposed event. `typeValue` is coerced to the canonical event vocabulary
// (@/lib/event-stages) so the UI can badge it and, later, pre-fill a create form.
export type EventIdea = {
  title: string;
  typeValue: string;
  idealSize: number;
  theme: string;
  whyNow: string;
  suggestedTiming: string;
  suggestedVenue: string;
  anchor: string;
  expectedOutcome: string;
  tier1: IdeaGuest[];
  tier2: IdeaGuest[];
  tier3External: IdeaExternalGuest[];
  agenda: string[];
};

// The model is asked for this many ideas, mirroring the prototype.
const IDEA_COUNT = 4;
// Defensive cap on how many we accept back.
const MAX_IDEAS = 6;
// Clamp the model's idealSize to a sane gathering range.
const MIN_SIZE = 2;
const MAX_SIZE = 60;
const DEFAULT_SIZE = 12;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// PURE: coerce one tier entry into a validated guest, dropping anything whose
// companyId isn't a supplied member (no invented attendees). Name is taken from
// the roster, not the model's output.
function coerceGuest(
  item: unknown,
  nameById: ReadonlyMap<string, string>,
): IdeaGuest | null {
  if (typeof item !== "object" || item === null) return null;
  const o = item as Record<string, unknown>;
  const companyId = str(o.companyId);
  const name = nameById.get(companyId);
  if (name === undefined) return null;
  return { companyId, name, why: str(o.why) };
}

// PURE: coerce a tier1/tier2 array, de-duping by companyId (a member should
// appear once per event) and skipping invalid entries.
function coerceGuestList(
  value: unknown,
  nameById: ReadonlyMap<string, string>,
  seen: Set<string>,
): IdeaGuest[] {
  if (!Array.isArray(value)) return [];
  const out: IdeaGuest[] = [];
  for (const item of value) {
    const g = coerceGuest(item, nameById);
    if (g && !seen.has(g.companyId)) {
      seen.add(g.companyId);
      out.push(g);
    }
  }
  return out;
}

// PURE: coerce the external-guest array (org name required).
function coerceExternalList(value: unknown): IdeaExternalGuest[] {
  if (!Array.isArray(value)) return [];
  const out: IdeaExternalGuest[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const org = str(o.org);
    if (org === "") continue;
    out.push({ org, why: str(o.why), isProspect: o.isProspect === true });
  }
  return out;
}

// PURE: coerce the agenda array to non-empty strings.
function coerceAgenda(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => str(v)).filter((s) => s.length > 0);
}

function coerceIdea(
  item: unknown,
  nameById: ReadonlyMap<string, string>,
): EventIdea | null {
  if (typeof item !== "object" || item === null) return null;
  const o = item as Record<string, unknown>;

  const title = str(o.title);
  // An idea with no title is unusable; drop it.
  if (title === "") return null;

  const typeRaw = str(o.type);
  const typeValue = isEventType(typeRaw) ? typeRaw : "other";

  const sizeRaw = typeof o.idealSize === "number" ? o.idealSize : Number(o.idealSize);
  const idealSize = Number.isFinite(sizeRaw)
    ? Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(sizeRaw)))
    : DEFAULT_SIZE;

  // tier1 and tier2 share one de-dup set — a member is either essential or a
  // strong add, not both, on the same event.
  const seen = new Set<string>();
  const tier1 = coerceGuestList(o.tier1, nameById, seen);
  const tier2 = coerceGuestList(o.tier2, nameById, seen);

  return {
    title,
    typeValue,
    idealSize,
    theme: str(o.theme),
    whyNow: str(o.whyNow),
    suggestedTiming: str(o.suggestedTiming),
    suggestedVenue: str(o.suggestedVenue),
    anchor: str(o.anchor),
    expectedOutcome: str(o.expectedOutcome),
    tier1,
    tier2,
    tier3External: coerceExternalList(o.tier3External),
    agenda: coerceAgenda(o.agenda),
  };
}

/// PURE: parse + validate the model's JSON array into event ideas. Tier-1/2
/// guests are validated against the supplied member roster (invented ids
/// dropped, names re-attached), ideas with no title are dropped, and the result
/// is capped to MAX_IDEAS. Robust to non-JSON / non-array responses.
export function parseEventIdeas(
  raw: string,
  members: readonly IdeaMember[],
): EventIdea[] {
  const json = extractJsonArray(raw);
  if (json === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const nameById = new Map(members.map((m) => [m.companyId, m.name]));

  const out: EventIdea[] = [];
  for (const item of parsed) {
    const idea = coerceIdea(item, nameById);
    if (idea) out.push(idea);
    if (out.length >= MAX_IDEAS) break;
  }
  return out;
}

// PURE: one member's profile line for the prompt (terse, id-tagged so the model
// can reference it back in tier lists).
function memberLine(m: IdeaMember): string {
  const parts = [`[ID:${m.companyId}] ${m.name}`];
  if (m.industry) parts.push(m.industry);
  if (m.status === "prospect") parts.push("PROSPECT");
  if (m.tags.length) parts.push(`Tags: ${m.tags.join(", ")}`);
  if (m.canOffer) parts.push(`Offers: ${m.canOffer.slice(0, 120)}`);
  if (m.lookingFor) parts.push(`Needs: ${m.lookingFor.slice(0, 120)}`);
  if (m.neverInvited) parts.push("NEVER INVITED");
  return parts.join(" | ");
}

// PURE: group members by (first token of) industry into clusters of >= 2 — the
// raw material for themed salon/roundtable ideas.
function clusterLines(members: readonly IdeaMember[]): string {
  const byIndustry = new Map<string, string[]>();
  for (const m of members) {
    const ind = (m.industry ?? "Other").split("/")[0].trim() || "Other";
    const bucket = byIndustry.get(ind) ?? [];
    bucket.push(m.name);
    byIndustry.set(ind, bucket);
  }
  return [...byIndustry.entries()]
    .filter(([, names]) => names.length >= 2)
    .map(([ind, names]) => `- ${ind} (${names.length}): ${names.slice(0, 6).join(", ")}`)
    .join("\n");
}

// PURE: the full user prompt handed to the model.
function buildPrompt(input: EventIdeasInput): string {
  const members = input.members
    .map(memberLine)
    .join("\n") || "(no members yet)";

  const neverInvited = input.members.filter((m) => m.neverInvited);
  const neverInvitedBlock = neverInvited.length
    ? `\n\nMEMBERS NEVER INVITED TO ANY EVENT (${neverInvited.length} — prioritise including them):\n${neverInvited
        .map((m) => `- [ID:${m.companyId}] ${m.name}`)
        .join("\n")}`
    : "";

  const projects = input.projects.length
    ? `\n\nACTIVE PROJECTS:\n${input.projects
        .map(
          (p) =>
            `- ${p.name} [${p.stage}]${p.type ? ` | ${p.type}` : ""}${p.county ? ` | ${p.county} County` : ""}`,
        )
        .join("\n")}`
    : "";

  const meetings = input.recentMeetings.length
    ? `\n\nRECENT MEETING INTELLIGENCE:\n${input.recentMeetings
        .map(
          (m) =>
            `- [${m.date ?? "?"}] ${m.title}${m.summary ? `: ${m.summary.replace(/\s+/g, " ").slice(0, 220)}` : ""}`,
        )
        .join("\n")}`
    : "";

  const history = input.eventHistory.length
    ? `\n\nPAST & UPCOMING EVENTS:\n${input.eventHistory
        .map(
          (e) =>
            `- "${e.name}" [${getEventType(e.type).label}, ${e.date ?? "TBD"}] ${e.attended} attended${e.theme ? ` | Theme: ${e.theme}` : ""}`,
        )
        .join("\n")}`
    : "\n\nNo events held yet.";

  const clusters = clusterLines(input.members);
  const clustersBlock = clusters
    ? `\n\nINDUSTRY CLUSTERS (for themed ideas):\n${clusters}`
    : "";

  const typeList = EVENT_TYPES.map((t) => `${t.value} (${t.label})`).join(", ");

  return `You are the event intelligence engine for ${input.orgName}, an economic-development membership network.

YOUR TASK: Suggest ${IDEA_COUNT} distinct events that would create genuine value for this member network RIGHT NOW. Each event must have a specific purpose grounded in real network activity — not generic networking.

── MEMBER NETWORK ──
${members}${neverInvitedBlock}${projects}${meetings}${history}${clustersBlock}

── EVENT TYPES AVAILABLE ──
${typeList}

RULES:
1. Every event must have a "whyNow" — a specific, datable trigger from the meeting data, project activity, or a network gap.
2. Include at least one "never invited" member in every event where they fit.
3. Tier 1 = essential attendees (the event fails without them). Tier 2 = strong additions. Tier 3 = external orgs / prospects not in the CRM.
4. Size events appropriately — intimate gatherings are often more valuable than large ones.
5. At least one event should be a working session with a concrete outcome, not just networking.
6. Suggest a specific venue — ideally a member's own space.
7. For tier1 and tier2, use ONLY the [ID:...] company ids from the member network above.

Return ONLY a valid JSON array of ${IDEA_COUNT} events — no prose, no markdown code fences:
[{
  "title": "<specific, evocative name>",
  "type": "<one of the event type values above>",
  "idealSize": <number ${MIN_SIZE}-${MAX_SIZE}>,
  "theme": "<2-3 sentences: the purpose and what conversation happens>",
  "whyNow": "<the specific recent trigger — cite meeting data, project stage, or gap>",
  "suggestedTiming": "<e.g. within 3 weeks, this summer, Q3>",
  "suggestedVenue": "<specific venue + why it works>",
  "anchor": "<the person or org whose presence makes others say yes>",
  "expectedOutcome": "<what this gathering concretely produces>",
  "tier1": [{"companyId":"<id from above>","why":"<one sentence>"}],
  "tier2": [{"companyId":"<id from above>","why":"<one sentence>"}],
  "tier3External": [{"org":"<org name>","why":"<why invite them>","isProspect":<true|false>}],
  "agenda": ["<item 1>","<item 2>","<item 3>"]
}]`;
}

const SYSTEM_PROMPT = `You are a precise event strategist for an economic-development membership network. Ground every suggestion in evidence from the network context provided — do not invent members, projects, or meeting activity. Each event must have a specific, datable reason to happen now. Reference members only by the [ID:...] company ids supplied.`;

/// Propose event ideas for the network. Validates the model's output against the
/// supplied member roster (no invented attendees). Ephemeral — nothing is stored;
/// the caller re-runs on demand.
export async function generateEventIdeas(
  input: EventIdeasInput,
): Promise<EventIdea[]> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildPrompt(input) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  return parseEventIdeas(text, input.members);
}
