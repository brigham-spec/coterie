import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  buildFocusContext,
  type FocusHorizon,
  type FocusItem,
} from "@/lib/daily-focus";

// Daily Focus AI synthesis (gap-audit cluster B, ported from the prototype's
// generateFocusSynthesis at Coterie.html:19454). Given the prioritised focus
// items for a horizon, the model writes a terse 2-3 sentence briefing of what to
// prioritise and why. Like the other AI features this is the single server-only
// seam: prompt, model, and output shape live here so tenant data only leaves
// through a shape we control and the API key never reaches the browser.
//
// EPHEMERAL — nothing is stored. It is regenerated on demand from current state.

// The instruction differs per horizon: today is about what to act on now, the
// week is about what moves the needle, the month is about staying ahead.
const HORIZON_BRIEF: Record<FocusHorizon, string> = {
  today:
    "Write EXACTLY 2-3 sentences identifying what to prioritise TODAY and why.",
  week:
    "Write EXACTLY 2-3 sentences identifying the most important things to advance or resolve THIS WEEK — what moves the needle most.",
  month:
    "Write EXACTLY 2-3 sentences about what to stay ahead of over the next 30 DAYS — upcoming events, active processes, and relationships to tend before they become urgent.",
};

function systemPrompt(userName: string, horizon: FocusHorizon): string {
  return `You are briefing ${userName}, a relationship manager at an economic-development organization, at the start of their day.

${HORIZON_BRIEF[horizon]}

Cite specific names, companies, events, and tasks from the supplied items — never invent facts, figures, or history that is not present. Be direct: no filler, no headers, no bullet points, no preamble like "Here is your briefing". Write in plain prose addressed to the reader.`;
}

/// Generate the 2-3 sentence briefing for a horizon. Ephemeral — nothing is
/// stored; the caller renders it inline. Throws on an empty model response so the
/// action can surface a friendly error.
export async function generateFocusSynthesis(
  items: FocusItem[],
  horizon: FocusHorizon,
  userName: string,
): Promise<string> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 200,
    system: systemPrompt(userName, horizon),
    messages: [
      {
        role: "user",
        content: `${buildFocusContext(items, horizon)}\n\nWrite the briefing now:`,
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (text === "") throw new Error("empty response from the model");

  return text;
}
