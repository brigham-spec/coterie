"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import { isIntroStage } from "@/lib/intro-stages";
import {
  generateIntroEmail,
  type IntroEmailDraft,
  type IntroParty,
} from "@/lib/intro-email";

// Introductions — the product's core verb (build item 4). A human-created intro
// is always source="manual" (detected/ai_suggested arrive later from Fireflies/
// AI). org_id is stamped from context; RLS WITH CHECK backstops the write.
//
// SECURITY: partyAContactId, partyBContactId, and projectId are all PLAIN FKs on
// id (no composite (id, org_id) guard) and Postgres FK checks bypass RLS, so a
// crafted foreign id would satisfy referential integrity. We re-verify each row
// belongs to THIS org inside the same withOrg tx (RLS scopes the lookups → a
// foreign id resolves null → throw) before creating.

export async function createIntroduction(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const partyAContactId = String(formData.get("partyAContactId") ?? "").trim();
  const partyBContactId = String(formData.get("partyBContactId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const madeOnRaw = String(formData.get("madeOn") ?? "").trim();

  if (!partyAContactId || !partyBContactId)
    throw new Error("both parties are required");
  if (!status) throw new Error("status is required");
  if (!isIntroStage(status)) throw new Error("invalid introduction status");
  if (partyAContactId === partyBContactId)
    throw new Error("the two parties must be different contacts");

  await withOrg(orgId, async (tx) => {
    // Sequential: one pooled connection per tx, so no concurrent queries.
    const a = await tx.contact.findUnique({ where: { id: partyAContactId } });
    const b = await tx.contact.findUnique({ where: { id: partyBContactId } });
    if (!a || !b) throw new Error("contact not found in this organization");

    if (projectId !== "") {
      const project = await tx.project.findUnique({ where: { id: projectId } });
      if (!project) throw new Error("project not found in this organization");
    }

    await tx.introduction.create({
      data: {
        orgId,
        partyAContactId,
        partyBContactId,
        status,
        source: "manual",
        projectId: projectId === "" ? null : projectId,
        madeOn: madeOnRaw === "" ? null : new Date(madeOnRaw),
      },
    });
  });

  revalidatePath("/dashboard/introductions");
}

// Advance an introduction along the lifecycle (slice 11.4a) and optionally record
// an outcome note. The row is re-loaded withOrg-scoped from the id in the form
// (RLS → a foreign id resolves null → refused), never trusting client-passed
// ownership. An emptied outcome clears the field.
export async function updateIntroduction(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const introId = String(formData.get("introId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const outcome = String(formData.get("outcome") ?? "").trim();
  if (!introId || !status) throw new Error("introduction and status are required");
  if (!isIntroStage(status)) throw new Error("invalid introduction status");

  await withOrg(orgId, async (tx) => {
    const intro = await tx.introduction.findUnique({ where: { id: introId } });
    if (!intro) throw new Error("introduction not found in this organization");

    await tx.introduction.update({
      where: { id: introId },
      data: { status, outcome: outcome === "" ? null : outcome },
    });
  });

  revalidatePath("/dashboard/introductions");
}

// Draft-introduction-email (gap-audit cluster E). Writes the warm double-opt-in
// email connecting two chosen contacts. Both parties are re-loaded withOrg-scoped
// from the ids in the form (never trusting a client payload), so a foreign id
// resolves null → we never draft using another tenant's contact. Each party's
// profile is drawn from the contact and its company (org, industry, what they
// seek / bring). The Anthropic call runs server-side in @/lib/intro-email; the key
// never reaches the browser. Ephemeral — nothing is persisted.
//
// This is a useActionState action: it returns state rather than throwing, so
// model/network failures render inline instead of tripping the error boundary.

export type IntroEmailState =
  | { status: "idle" }
  | { status: "ok"; draft: IntroEmailDraft }
  | { status: "error"; message: string };

export async function draftIntroEmail(
  _prev: IntroEmailState,
  formData: FormData,
): Promise<IntroEmailState> {
  const partyAContactId = String(formData.get("partyAContactId") ?? "").trim();
  const partyBContactId = String(formData.get("partyBContactId") ?? "").trim();
  const context = String(formData.get("context") ?? "").trim();

  if (!partyAContactId || !partyBContactId)
    return { status: "error", message: "Select both parties." };
  if (partyAContactId === partyBContactId)
    return { status: "error", message: "Select two different contacts." };

  const { orgId, orgName, userName } = await requireOrgContext();

  const contactSelect = {
    name: true,
    title: true,
    company: {
      select: {
        name: true,
        industry: true,
        lookingFor: true,
        canOffer: true,
      },
    },
  } as const;

  const data = await withOrg(orgId, async (tx) => {
    // Sequential: one pooled connection per tx, so no concurrent queries.
    const a = await tx.contact.findUnique({
      where: { id: partyAContactId },
      select: contactSelect,
    });
    const b = await tx.contact.findUnique({
      where: { id: partyBContactId },
      select: contactSelect,
    });
    if (a == null || b == null) return null;
    return { a, b };
  });

  if (data == null)
    return { status: "error", message: "contact not found in this organization" };

  const toParty = (c: {
    name: string;
    title: string | null;
    company: {
      name: string;
      industry: string | null;
      lookingFor: string | null;
      canOffer: string | null;
    };
  }): IntroParty => ({
    name: c.name,
    org: c.company.name,
    title: c.title,
    industry: c.company.industry,
    seeking: c.company.lookingFor,
    brings: c.company.canOffer,
  });

  try {
    await enforceAiRateLimit(orgId);
    const draft = await generateIntroEmail({
      orgName,
      host: userName,
      partyA: toParty(data.a),
      partyB: toParty(data.b),
      context,
    });
    if (draft == null)
      return { status: "error", message: "Could not draft an email. Try again." };
    return { status: "ok", draft };
  } catch (err) {
    console.error("intro email draft failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not draft an email. Try again." };
  }
}
