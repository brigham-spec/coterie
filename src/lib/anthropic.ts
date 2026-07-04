import "server-only";

import Anthropic from "@anthropic-ai/sdk";

// Server-only Anthropic wrapper (build item 5). The API key lives in
// ANTHROPIC_API_KEY and is read by the SDK from the environment — it is NEVER
// shipped to the client. Every caller must be a server action / server
// component so the key stays on the server. The `server-only` import makes a
// client-side import a build error, backstopping that boundary.
//
// This module is intentionally the single seam to Anthropic: all prompts and
// model choices live here, so tenant data never leaves except through a shape
// we control, and there is one place to audit what we send.

// The economic-development relationship context this product serves. Kept terse
// and factual so the model summarizes rather than embellishes.
export type CompanyBriefInput = {
  name: string;
  status: string;
  industry: string | null;
  tier: string | null;
  annualValue: string | null;
  temperature: number | null;
  source: string | null;
  emailDomain: string | null;
  website: string | null;
  notes: string | null;
  contacts: Array<{ name: string; title: string | null }>;
  projects: Array<{ name: string; stage: string; role: string }>;
};

const SYSTEM_PROMPT = `You are a briefing assistant for an economic-development organization's relationship managers. Given the structured record of a company in their network, write a short, factual internal brief (roughly 120-180 words) that a relationship manager can read before a meeting.

Cover, only where the data supports it: who the company is and its standing in the network, the state of the relationship, the key contacts, and any projects it participates in. Close with one or two concrete, specific suggestions for the next touchpoint.

Ground every statement in the supplied data — do not invent facts, figures, news, or history that is not present. If a field is missing, simply omit it rather than speculating. Write in plain, direct prose (no headers, no bullet lists, no preamble like "Here is the brief").`;

export async function generateCompanyBrief(
  input: CompanyBriefInput,
): Promise<string> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Company record:\n\n${JSON.stringify(input, null, 2)}`,
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
