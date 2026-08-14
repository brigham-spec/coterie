"use server";

import Anthropic from "@anthropic-ai/sdk";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import {
  buildFocusItems,
  type FocusCommitment,
  type FocusEvent,
  type FocusHorizon,
} from "@/lib/daily-focus";
import {
  applyAgendaStates,
  isAgendaItemKind,
  isAgendaState,
  snoozeUntil,
  type AgendaFocusItem,
  type AgendaState,
  type StoredAgendaState,
} from "@/lib/agenda-state";
import { generateFocusSynthesis } from "@/lib/daily-focus-synthesis";
import { resolveScope } from "@/lib/dashboard-scope";

// Daily Focus action (gap-audit cluster B). The client card holds only the active
// horizon; the whole assembly runs here so the Anthropic key never crosses to the
// browser. In ONE withOrg pass we load this org's open commitments and upcoming
// events, bucket them for the requested horizon, and — if any land — write the
// briefing. Ephemeral: nothing is persisted. Returns state (never throws) so a
// model/network failure renders inline instead of tripping the error boundary.

const HORIZONS: readonly FocusHorizon[] = ["today", "week", "month"];

function isFocusHorizon(value: string): value is FocusHorizon {
  return (HORIZONS as readonly string[]).includes(value);
}

export type DailyFocusState =
  | { status: "idle" }
  | { status: "empty"; horizon: FocusHorizon }
  | {
      status: "ok";
      horizon: FocusHorizon;
      synthesis: string;
      items: AgendaFocusItem[];
    }
  | { status: "error"; message: string };

const DAY = 86_400_000;

export async function generateDailyFocus(
  _prev: DailyFocusState,
  formData: FormData,
): Promise<DailyFocusState> {
  const horizon = String(formData.get("horizon") ?? "").trim();
  if (!isFocusHorizon(horizon))
    return { status: "error", message: "invalid horizon" };

  const { orgId, userId, userName, role } = await requireOrgContext();

  // Personal-vs-org scoping, re-resolved server-side through the same clamp as
  // the page so a staff user can't widen to "everyone" by editing the field.
  const scope = resolveScope(role === "admin", String(formData.get("scope") ?? ""));

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // The widest horizon reaches 30 days out, so bound the event query there.
  const monthEdge = new Date(startOfToday.getTime() + 31 * DAY);

  const { commitments, events, states } = await withOrg(orgId, async (tx) => {
    const rawCommitments = await tx.actionItem.findMany({
      // "mine" keeps only commitments this user owns (staff-owned "we owe" rows);
      // "everyone" is the whole org. Events below stay shared in both scopes.
      where:
        scope === "mine"
          ? { status: "open", ownerUserId: userId }
          : { status: "open" },
      select: {
        id: true,
        text: true,
        dueDate: true,
        ownerUser: { select: { name: true } },
        ownerContact: {
          select: { name: true, company: { select: { name: true } } },
        },
        meeting: { select: { title: true } },
      },
    });
    const rawEvents = await tx.event.findMany({
      where: {
        date: { gte: startOfToday, lt: monthEdge },
        stage: { notIn: ["completed", "cancelled"] },
      },
      orderBy: { date: "asc" },
      select: { id: true, name: true, date: true, venue: true },
    });
    // The triage overlay — done items and unexpired snoozes drop from the focus.
    const rawStates = await tx.agendaItemState.findMany({
      select: { kind: true, refId: true, state: true, snoozedUntil: true },
    });
    return { commitments: rawCommitments, events: rawEvents, states: rawStates };
  });

  // Shape to the pure engine's inputs, classifying each commitment by owner side.
  // The owner-XOR CHECK guarantees exactly one owner is set; a row with neither is
  // malformed and is skipped.
  const focusCommitments: FocusCommitment[] = [];
  for (const c of commitments) {
    if (c.ownerUser != null) {
      focusCommitments.push({
        id: c.id,
        text: c.text,
        side: "we_owe",
        ownerName: c.ownerUser.name,
        companyName: null,
        meetingTitle: c.meeting?.title ?? null,
        dueDate: c.dueDate,
      });
    } else if (c.ownerContact != null) {
      focusCommitments.push({
        id: c.id,
        text: c.text,
        side: "they_owe",
        ownerName: c.ownerContact.name,
        companyName: c.ownerContact.company?.name ?? null,
        meetingTitle: c.meeting?.title ?? null,
        dueDate: c.dueDate,
      });
    }
  }

  const focusEvents: FocusEvent[] = events.map((e) => ({
    id: e.id,
    name: e.name,
    date: e.date,
    venue: e.venue,
  }));

  const built = buildFocusItems(
    { commitments: focusCommitments, events: focusEvents },
    horizon,
    now,
  );

  // Fold the triage overlay on: drop done + still-snoozed items, tag the waiting
  // ones. Only well-formed stored states are kept (defensive against hand edits).
  const stored: StoredAgendaState[] = states.flatMap((s) =>
    isAgendaItemKind(s.kind) && isAgendaState(s.state)
      ? [{ kind: s.kind, refId: s.refId, state: s.state, snoozedUntil: s.snoozedUntil }]
      : [],
  );
  const items = applyAgendaStates(built, stored, now);

  if (items.length === 0) return { status: "empty", horizon };

  try {
    await enforceAiRateLimit(orgId);
    const synthesis = await generateFocusSynthesis(items, horizon, userName);
    return { status: "ok", horizon, synthesis, items };
  } catch (err) {
    console.error("daily focus synthesis failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not write your briefing. Try again." };
  }
}

export type AgendaStateResult = { status: "ok" } | { status: "error" };

// Triage a single focus item: mark it done/snoozed/waiting, or "clear" to drop the
// overlay (the item returns untouched). Keyed by (kind, refId) — the durable id of
// the underlying commitment/event — so the mark survives regeneration. Cheap and
// AI-free (the card re-synthesises lazily on the next Generate); returns a result
// so a failure renders inline in the card instead of tripping the error boundary.
export async function setAgendaItemState(
  kind: string,
  refId: string,
  next: AgendaState | "clear",
): Promise<AgendaStateResult> {
  const { orgId } = await requireOrgContext();
  const cleanKind = kind.trim();
  const cleanRef = refId.trim();
  if (!isAgendaItemKind(cleanKind) || !cleanRef) return { status: "error" };

  try {
    await withOrg(orgId, async (tx) => {
      if (next === "clear") {
        await tx.agendaItemState.deleteMany({
          where: { kind: cleanKind, refId: cleanRef },
        });
        return;
      }
      const snoozedUntil = next === "snoozed" ? snoozeUntil(new Date()) : null;
      await tx.agendaItemState.upsert({
        where: { orgId_kind_refId: { orgId, kind: cleanKind, refId: cleanRef } },
        create: { orgId, kind: cleanKind, refId: cleanRef, state: next, snoozedUntil },
        update: { state: next, snoozedUntil },
      });
    });
    return { status: "ok" };
  } catch (err) {
    console.error("agenda item state update failed", err);
    return { status: "error" };
  }
}
