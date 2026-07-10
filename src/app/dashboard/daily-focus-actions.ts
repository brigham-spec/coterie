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
  type FocusItem,
} from "@/lib/daily-focus";
import { generateFocusSynthesis } from "@/lib/daily-focus-synthesis";

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
      items: FocusItem[];
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

  const { orgId, userName } = await requireOrgContext();

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // The widest horizon reaches 30 days out, so bound the event query there.
  const monthEdge = new Date(startOfToday.getTime() + 31 * DAY);

  const { commitments, events } = await withOrg(orgId, async (tx) => {
    const rawCommitments = await tx.actionItem.findMany({
      where: { status: "open" },
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
    return { commitments: rawCommitments, events: rawEvents };
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

  const items = buildFocusItems(
    { commitments: focusCommitments, events: focusEvents },
    horizon,
    now,
  );

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
