"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import {
  cleanTitle,
  isKnowledgeKind,
  normalizeExtractedText,
} from "@/lib/knowledge-docs";
import {
  KnowledgeExtractError,
  extractTextFromUpload,
} from "@/lib/knowledge-extract";

// Admin-managed collateral store. addKnowledgeDoc takes either an uploaded file
// (PDF or text, extracted server-side) or pasted text, and stores the normalized
// TEXT as a KnowledgeDoc for the current tenant. The gate is an in-action role
// check returning an error state (not requireAdmin's throw) so it surfaces
// cleanly through useActionState — the same idiom the other settings mutations
// use.

export type KnowledgeUploadState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ok"; title: string; charCount: number };

export type KnowledgeDeleteState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ok" };

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

export async function addKnowledgeDoc(
  _prev: KnowledgeUploadState,
  formData: FormData,
): Promise<KnowledgeUploadState> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "admin")
    return { status: "error", message: "Only admins can manage collateral." };

  const kind = formData.get("kind");
  if (!isKnowledgeKind(kind))
    return { status: "error", message: "Choose a document type." };

  const file = formData.get("file");
  const pasted = String(formData.get("text") ?? "");
  const hasFile = file instanceof File && file.size > 0;

  let content: string;
  let sourceName: string | null = null;
  if (hasFile) {
    try {
      content = await extractTextFromUpload(file);
    } catch (err) {
      if (err instanceof KnowledgeExtractError)
        return { status: "error", message: err.message };
      throw err;
    }
    sourceName = file.name;
  } else if (pasted.trim() !== "") {
    content = normalizeExtractedText(pasted);
    if (content === "")
      return { status: "error", message: "The pasted text is empty." };
  } else {
    return { status: "error", message: "Upload a file or paste text." };
  }

  const title =
    cleanTitle(String(formData.get("title") ?? "")) ||
    (sourceName ? cleanTitle(stripExtension(sourceName)) : "");
  if (title === "")
    return { status: "error", message: "Add a title." };

  await withOrg(ctx.orgId, (tx) =>
    tx.knowledgeDoc.create({
      data: {
        orgId: ctx.orgId,
        kind,
        title,
        content,
        sourceName,
        charCount: content.length,
        createdByUserId: ctx.userId,
      },
    }),
  );

  revalidatePath("/dashboard/settings");
  return { status: "ok", title, charCount: content.length };
}

export async function deleteKnowledgeDoc(
  _prev: KnowledgeDeleteState,
  formData: FormData,
): Promise<KnowledgeDeleteState> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "admin")
    return { status: "error", message: "Only admins can manage collateral." };

  const id = String(formData.get("id") ?? "");
  if (id === "") return { status: "error", message: "Missing document." };

  const deleted = await withOrg(ctx.orgId, (tx) =>
    tx.knowledgeDoc.deleteMany({ where: { id } }),
  );
  if (deleted.count === 0)
    return { status: "error", message: "Document not found." };

  revalidatePath("/dashboard/settings");
  return { status: "ok" };
}
