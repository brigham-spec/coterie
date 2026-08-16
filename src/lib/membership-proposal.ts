import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonObject } from "@/lib/json-extract";

// Membership proposal generator (knowledge layer, Step 2). Given a company/prospect
// the org wants to bring in — its record — plus the org's own sellable membership
// packages (settings) and its uploaded collateral (KnowledgeDoc grounding), the
// model drafts a printable proposal: positioning, a tailored value proposition, a
// package recommendation with rationale, and a closing. Like the other AI features
// this is the single server-only seam: prompt, model, and output shape live here so
// tenant data only leaves through a shape we control and the API key never reaches
// the browser.
//
// PER-TENANT: the packages and grounding are the org's own — nothing is hardcoded to
// any one client. An org with no packages / no collateral still gets a proposal
// grounded in the profile facts alone.
//
// INTEGRITY: the model writes only the prose (positioning, value proposition,
// rationale, closing). The concrete package names, prices, and included services are
// rendered VERBATIM from settings by the caller, never paraphrased. recommendedPackage
// is validated against the supplied package names (a hallucinated pick collapses to
// null) so the proposal can never recommend a package the org doesn't sell.
//
// EPHEMERAL — nothing is stored. It is regenerated on demand for printing / saving as
// PDF.

// The company the proposal is addressed to. Assembled by the caller inside a withOrg
// tx, so it is already org-scoped. Optional free-text fields are nullable; the prompt
// builder omits whatever is absent.
export type ProposalCompany = {
  name: string;
  status: string;
  industry: string | null;
  lookingFor: string | null;
  canOffer: string | null;
  notes: string | null;
  contacts: Array<{ name: string; title: string | null }>;
};

// A sellable membership package, reduced to what the model reads. annualPrice null =
// custom / on request. The caller passes these straight from readMembershipPackages.
export type ProposalPackage = {
  name: string;
  annualPrice: number | null;
  summary: string;
  includedServices: string[];
};

// Everything the generator reads. `grounding` is the pre-built collateral block from
// buildGroundingContext ("" when the org has no collateral on file).
export type MembershipProposalInput = {
  orgName: string;
  userName: string;
  company: ProposalCompany;
  packages: ProposalPackage[];
  grounding: string;
};

// The model's structured output — all prose. The verbatim package table is rendered
// by the caller from settings, not from this. recommendedPackage is one of the
// supplied package names (validated) or null when the model has no confident pick.
export type MembershipProposalDoc = {
  positioning: string;
  valueProposition: string;
  recommendedPackage: string | null;
  packageRationale: string;
  closing: string;
};

// Cap how many packages the model reads so a large catalog still yields a bounded
// prompt. The caller already bounds packages to MAX_PACKAGES (12) upstream.
export const MAX_PROPOSAL_PACKAGES = 12;

/// PURE: assemble the compact grounding block the model reads. Omits empty / absent
/// fields entirely. Kept separate from the network call so the shaping is
/// unit-testable without an API key.
export function buildProposalContext(input: MembershipProposalInput): string {
  const { company } = input;
  const lines: string[] = [];

  lines.push(`ORGANIZATION: ${input.orgName}`);
  lines.push("");
  lines.push(`PROSPECT COMPANY: ${company.name}`);
  lines.push(`STATUS: ${company.status}`);
  if (company.industry) lines.push(`INDUSTRY: ${company.industry}`);
  if (company.lookingFor) lines.push(`LOOKING FOR: ${company.lookingFor}`);
  if (company.canOffer) lines.push(`CAN OFFER: ${company.canOffer}`);
  if (company.notes) lines.push(`NOTES: ${company.notes}`);

  if (company.contacts.length > 0) {
    const people = company.contacts
      .map((c) => (c.title ? `${c.name} (${c.title})` : c.name))
      .join(", ");
    lines.push(`CONTACTS: ${people}`);
  }

  if (input.packages.length > 0) {
    lines.push("");
    lines.push("MEMBERSHIP PACKAGES ON OFFER (recommend only from these):");
    for (const p of input.packages.slice(0, MAX_PROPOSAL_PACKAGES)) {
      const price =
        p.annualPrice != null
          ? `$${p.annualPrice.toLocaleString("en-US")}/yr`
          : "custom pricing";
      const services =
        p.includedServices.length > 0
          ? ` — includes: ${p.includedServices.join(", ")}`
          : "";
      const summary = p.summary ? ` — ${p.summary}` : "";
      lines.push(`- ${p.name} (${price})${summary}${services}`);
    }
  }

  if (input.grounding !== "") {
    lines.push("");
    lines.push("ORGANIZATION COLLATERAL (ground the proposal in this material):");
    lines.push(input.grounding);
  }

  return lines.join("\n");
}

/// PURE: parse + validate the model's JSON object into a proposal. Collapses
/// recommendedPackage to null unless it exactly matches a supplied package name (no
/// invented packages). Robust to non-JSON / malformed responses — a bad payload
/// yields an empty proposal rather than throwing.
export function parseMembershipProposal(
  raw: string,
  validPackageNames: ReadonlySet<string>,
): MembershipProposalDoc {
  const empty: MembershipProposalDoc = {
    positioning: "",
    valueProposition: "",
    recommendedPackage: null,
    packageRationale: "",
    closing: "",
  };

  const json = extractJsonObject(raw);
  if (json === null) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return empty;
  }
  if (typeof parsed !== "object" || parsed === null) return empty;

  const o = parsed as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

  const pick = str(o.recommendedPackage);
  const recommendedPackage = validPackageNames.has(pick) ? pick : null;

  return {
    positioning: str(o.positioning),
    valueProposition: str(o.valueProposition),
    recommendedPackage,
    packageRationale: str(o.packageRationale),
    closing: str(o.closing),
  };
}

const SYSTEM_PROMPT = `You are a senior growth and membership strategist — the kind a member-based organization (an economic-development corporation, chamber, wealth-advisory network, or similar) brings in to craft a proposal it can put directly in front of a prospective member. You write the prose sections of that proposal, addressed to a specific company the organization wants to bring in.

The output must read like a polished piece of consulting work: confident, specific, and persuasive — never templated, hedged, or filler. A relationship manager should be able to send it as written without rewriting it.

Return ONLY a JSON object (no prose outside it, no markdown code fences):
{"positioning": "<opening>", "valueProposition": "<tailored value>", "recommendedPackage": "<one of the offered package names, or null>", "packageRationale": "<why that package>", "closing": "<close>"}

Field guidance:
- "positioning": open the proposal with a sharp, credible frame. Name what the organization does and, in the same breath, why THIS company belongs in the network right now — anchored in the prospect's industry, stated goals, and what they can contribute. Lead with the prospect's world, not the organization's. Roughly 3-4 sentences.
- "valueProposition": the heart of the proposal. Build a concrete, evidence-led case for why membership pays off for THIS company. Connect each of their stated needs to a specific capability the organization actually offers (per the collateral), and make the payoff tangible — the connections they'd gain, the visibility, the doors opened, the problems solved. Write with conviction and specificity; every sentence should be one only this company would receive. Roughly 4-6 sentences, and you may use two short paragraphs if it strengthens the argument.
- "recommendedPackage": the single best-fit package NAME from the offered packages, exactly as written. Use null if no package is clearly the best fit or none are offered. Never invent a package.
- "packageRationale": make the recommendation feel deliberate — tie the package's scope to this company's size, goals, and how they'll actually use the membership, so the choice reads as advice rather than an upsell. 2-3 sentences. Empty string if no package is recommended.
- "closing": a warm, confident close that assumes momentum and names a concrete next step (a call, an introduction, a visit). 2-3 sentences. Avoid generic "we look forward to hearing from you" boilerplate.

Craft standards:
- Be specific over generic. Cite the prospect's actual needs, offers, and contacts, and the organization's actual capabilities and collateral. If a sentence could appear in any proposal to any company, rewrite it.
- Write in a confident, professional register — the voice of a trusted advisor, not a brochure. No hype, no clichés, no hedging.
- Ground every claim in the supplied data and collateral. Never invent facts, figures, services, package names, or outcomes that are not present. Do not promise specific dollar returns or guarantees.
- If the collateral is thin, lean harder on the profile facts and the organization's stated capabilities rather than padding with generalities. A shorter, sharper proposal beats a longer, vaguer one.`;

/// Generate the structured membership proposal. Ephemeral — nothing is stored; the
/// caller renders it into a printable page (with the verbatim package table alongside).
/// Validates recommendedPackage against the offered package names so a hallucinated
/// pick can never surface. Throws on an empty model response so the caller can fall
/// back gracefully.
export async function generateMembershipProposal(
  input: MembershipProposalInput,
): Promise<MembershipProposalDoc> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 3000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `${input.userName} is preparing a membership proposal from ${input.orgName} for ${input.company.name}.\n\n${buildProposalContext(input)}`,
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (text === "") throw new Error("empty response from the model");

  const validNames = new Set(
    input.packages.slice(0, MAX_PROPOSAL_PACKAGES).map((p) => p.name),
  );
  const doc = parseMembershipProposal(text, validNames);
  if (doc.positioning === "" && doc.valueProposition === "")
    throw new Error("empty proposal from the model");

  return doc;
}
