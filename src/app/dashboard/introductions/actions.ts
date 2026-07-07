"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";

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
  if (partyAContactId === partyBContactId)
    throw new Error("the two parties must be different contacts");

  await withOrg(orgId, async (tx) => {
    const [a, b] = await Promise.all([
      tx.contact.findUnique({ where: { id: partyAContactId } }),
      tx.contact.findUnique({ where: { id: partyBContactId } }),
    ]);
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
