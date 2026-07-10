"use server";

import { revalidatePath } from "next/cache";

import Anthropic from "@anthropic-ai/sdk";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import {
  generateQuickCapture,
  type CaptureContact,
  type CaptureIntro,
  type CaptureProspect,
} from "@/lib/quick-capture";

// Quick-capture helper actions (gap-audit cluster E). Two seams:
//   • parseQuickCaptureAction — the AI call. Reads a plain-English note, loads
//     this tenant's contacts as match context, and returns a structured capture
//     for the operator to review. Ephemeral; nothing is stored.
//   • saveQuickCapture — the write. Takes the REVIEWED capture and, in one
//     withOrg tx, records a meeting (matched contacts as attendees, follow-ups
//     folded into the summary) and any brand-new prospects. Suggested intros are
//     display-only — never auto-made.
// Follow-ups are deliberately NOT written as ActionItem rows: action_items carry
// an owner-XOR CHECK and this codebase never auto-assigns a guessed owner (see
// @/lib/inngest) — the operator runs the meeting's extract-action-items flow to
// attribute them. org_id is stamped from context; matched ids are re-verified
// inside the tx so a foreign id is refused by RLS.

const CONTACT_CONTEXT_LIMIT = 300;

export type CaptureReview = {
  title: string;
  date: string;
  summary: string;
  actionItems: string[];
  suggestedIntros: CaptureIntro[];
  newProspects: CaptureProspect[];
  matched: CaptureContact[];
};

export type QuickCaptureState =
  | { status: "idle" }
  | { status: "ok"; review: CaptureReview }
  | { status: "error"; message: string };

export async function parseQuickCaptureAction(
  _prev: QuickCaptureState,
  formData: FormData,
): Promise<QuickCaptureState> {
  const note = String(formData.get("note") ?? "").trim();
  if (note === "")
    return { status: "error", message: "Describe what happened first." };

  try {
    const { orgId } = await requireOrgContext();

    const contacts = await withOrg(orgId, (tx) =>
      tx.contact.findMany({
        take: CONTACT_CONTEXT_LIMIT,
        orderBy: { name: "asc" },
        select: { id: true, name: true, company: { select: { name: true } } },
      }),
    );
    const context: CaptureContact[] = contacts.map((c) => ({
      id: c.id,
      name: c.name,
      org: c.company.name,
    }));

    await enforceAiRateLimit(orgId);
    const today = new Date().toISOString().slice(0, 10);
    const parsed = await generateQuickCapture(note, context, today);
    if (parsed == null)
      return {
        status: "error",
        message: "Nothing to capture from that note. Try adding more detail.",
      };

    // Resolve matched ids to display rows (only ids that are real contacts here).
    const byId = new Map(context.map((c) => [c.id, c]));
    const matched = parsed.matchedContactIds
      .map((id) => byId.get(id))
      .filter((c): c is CaptureContact => c != null);

    const review: CaptureReview = {
      title: parsed.title,
      date: parsed.date,
      summary: parsed.summary,
      actionItems: parsed.actionItems,
      suggestedIntros: parsed.suggestedIntros,
      newProspects: parsed.newProspects,
      matched,
    };
    return { status: "ok", review };
  } catch (err) {
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Add an API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy. Please try again shortly." };
    console.error("quick capture parse failed", err);
    return { status: "error", message: "Could not read that note. Try again." };
  }
}

export type SaveCaptureState =
  | { status: "idle" }
  | { status: "saved"; meeting: boolean; attendees: number; prospects: number }
  | { status: "error"; message: string };

// PURE-ish: defensively reconstruct the reviewed capture from the client payload.
// The client is not trusted — matched ids are re-verified against the DB in the
// action, and every field is coerced here before use.
function readReview(raw: string): CaptureReview | null {
  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const matched = Array.isArray(obj.matched)
    ? obj.matched
        .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
        .map((m) => ({ id: s(m.id), name: s(m.name), org: s(m.org) }))
        .filter((m) => m.id !== "")
    : [];
  const actionItems = Array.isArray(obj.actionItems)
    ? obj.actionItems.map(s).filter((l) => l !== "")
    : [];
  const newProspects = Array.isArray(obj.newProspects)
    ? obj.newProspects
        .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
        .map((p) => ({ name: s(p.name), org: s(p.org), notes: s(p.notes) }))
        .filter((p) => p.name !== "" || p.org !== "")
    : [];
  return {
    title: s(obj.title),
    date: s(obj.date),
    summary: s(obj.summary),
    actionItems,
    suggestedIntros: [],
    newProspects,
    matched,
  };
}

// Compose the meeting summary from the note summary plus the follow-ups (folded
// in as text, since we do not auto-create owner-attributed action items).
function composeSummary(summary: string, actionItems: string[]): string {
  const parts: string[] = [];
  if (summary !== "") parts.push(summary);
  if (actionItems.length > 0)
    parts.push(["Follow-ups:", ...actionItems.map((a) => `- ${a}`)].join("\n"));
  return parts.join("\n\n");
}

export async function saveQuickCapture(
  _prev: SaveCaptureState,
  formData: FormData,
): Promise<SaveCaptureState> {
  const review = readReview(String(formData.get("capture") ?? ""));
  if (review == null)
    return { status: "error", message: "Nothing to save." };

  const heldAt = /^\d{4}-\d{2}-\d{2}$/.test(review.date)
    ? new Date(`${review.date}T12:00:00Z`)
    : new Date();

  try {
    const { orgId } = await requireOrgContext();

    return await withOrg(orgId, async (tx) => {
      // Re-verify matched contacts belong to THIS tenant (RLS scopes the read).
      const ids = review.matched.map((m) => m.id);
      const validContacts =
        ids.length === 0
          ? []
          : await tx.contact.findMany({
              where: { id: { in: ids } },
              select: { id: true, companyId: true },
            });

      const summaryText = composeSummary(review.summary, review.actionItems);
      const hasMeeting =
        validContacts.length > 0 ||
        review.actionItems.length > 0 ||
        summaryText !== "";

      let attendees = 0;
      if (hasMeeting) {
        const meeting = await tx.meeting.create({
          data: {
            orgId,
            title: review.title || "Quick Capture",
            heldAt,
            summary: summaryText || null,
          },
          select: { id: true },
        });

        if (validContacts.length > 0) {
          await tx.meetingAttendee.createMany({
            data: validContacts.map((c) => ({
              orgId,
              meetingId: meeting.id,
              contactId: c.id,
              matchMethod: "manual",
              confidence: 1,
              confirmed: true,
            })),
          });
          attendees = validContacts.length;

          // Freshen the touched companies' last-contact clock.
          const companyIds = [...new Set(validContacts.map((c) => c.companyId))];
          await tx.company.updateMany({
            where: { id: { in: companyIds } },
            data: { lastContactAt: heldAt },
          });
        }
      }

      // New prospects: skip any whose company name already exists (dedupe),
      // otherwise create a prospect (+ primary contact when a person is named).
      let prospects = 0;
      for (const p of review.newProspects) {
        const companyName = p.org || p.name;
        if (companyName === "") continue;
        const existing = await tx.company.findFirst({
          where: { name: { equals: companyName, mode: "insensitive" } },
          select: { id: true },
        });
        if (existing) continue;
        await tx.company.create({
          data: {
            orgId,
            name: companyName,
            status: "prospect",
            industry: "Other",
            annualValue: "0",
            source: "Quick Capture",
            notes: p.notes,
            contacts:
              p.name === ""
                ? undefined
                : { create: { orgId, name: p.name, isPrimary: true } },
          },
        });
        prospects++;
      }

      return {
        status: "saved" as const,
        meeting: hasMeeting,
        attendees,
        prospects,
      };
    });
  } catch (err) {
    console.error("quick capture save failed", err);
    return { status: "error", message: "Could not save this capture. Try again." };
  } finally {
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/meetings");
    revalidatePath("/dashboard/companies");
  }
}
