"use server";

import { revalidatePath } from "next/cache";

import Anthropic from "@anthropic-ai/sdk";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import {
  generateLinkedInProfile,
  type LinkedInProfile,
} from "@/lib/linkedin-parse";

// LinkedIn-parse helper actions (gap-audit cluster E). Two seams:
//   • parseLinkedInProfileAction — the AI call. Reads pasted text, returns the
//     extracted fields for the operator to review. Ephemeral; nothing is stored.
//   • createProspectFromLinkedIn — the write. Takes the REVIEWED fields (the
//     operator may have edited them) and creates a prospect company + primary
//     contact, or attaches the contact to an existing company of the same name.
// org_id is stamped from the resolved context, never from the form — RLS's WITH
// CHECK backstops writes. Both return state (never throw) so the client panel
// renders success/failure inline.

export type LinkedInParseState =
  | { status: "idle" }
  | { status: "ok"; profile: LinkedInProfile }
  | { status: "error"; message: string };

// Extract structured prospect fields from a pasted LinkedIn profile.
export async function parseLinkedInProfileAction(
  _prev: LinkedInParseState,
  formData: FormData,
): Promise<LinkedInParseState> {
  const text = String(formData.get("profile") ?? "").trim();
  if (text === "")
    return { status: "error", message: "Paste a LinkedIn profile first." };

  try {
    const { orgId } = await requireOrgContext();
    await enforceAiRateLimit(orgId);

    const profile = await generateLinkedInProfile(text);
    if (profile == null)
      return {
        status: "error",
        message: "Could not read a profile from that text. Try again.",
      };

    return { status: "ok", profile };
  } catch (err) {
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Add an API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy. Please try again shortly." };
    console.error("parse LinkedIn profile failed", err);
    return { status: "error", message: "Could not parse the profile. Try again." };
  }
}

export type CreateProspectState =
  | { status: "idle" }
  | { status: "added"; companyId: string; companyName: string }
  | { status: "attached"; companyId: string; companyName: string }
  | { status: "error"; message: string };

// Create a prospect from the reviewed fields. The company name (org) is required;
// everything else is optional. If a company with the same name already exists we
// attach the contact there rather than creating a duplicate.
export async function createProspectFromLinkedIn(
  _prev: CreateProspectState,
  formData: FormData,
): Promise<CreateProspectState> {
  const org = String(formData.get("org") ?? "").trim();
  if (org === "")
    return { status: "error", message: "A company name is required to save." };

  const contactName = String(formData.get("name") ?? "").trim();
  const industry = String(formData.get("industry") ?? "").trim() || "Other";
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const linkedin = String(formData.get("linkedin") ?? "").trim();
  const website = String(formData.get("website") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const lookingFor = String(formData.get("lookingFor") ?? "").trim();
  const canOffer = String(formData.get("canOffer") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  try {
    const { orgId } = await requireOrgContext();

    return await withOrg(orgId, async (tx) => {
      const existing = await tx.company.findFirst({
        where: { name: { equals: org, mode: "insensitive" } },
        select: { id: true, name: true },
      });

      if (existing) {
        if (contactName !== "") {
          const dupe = email
            ? await tx.contact.findFirst({
                where: {
                  companyId: existing.id,
                  email: { equals: email, mode: "insensitive" },
                },
                select: { id: true },
              })
            : null;
          if (dupe == null)
            await tx.contact.create({
              data: {
                orgId,
                companyId: existing.id,
                name: contactName,
                email: email || null,
                phone: phone || null,
                title: title || null,
                linkedin: linkedin || null,
              },
            });
        }
        return {
          status: "attached" as const,
          companyId: existing.id,
          companyName: existing.name,
        };
      }

      const company = await tx.company.create({
        data: {
          orgId,
          name: org,
          status: "prospect",
          industry,
          annualValue: "0",
          website: website || null,
          counties: location ? [location] : [],
          source: "LinkedIn",
          lookingFor: lookingFor || null,
          canOffer: canOffer || null,
          notes,
          contacts:
            contactName === ""
              ? undefined
              : {
                  create: {
                    orgId,
                    name: contactName,
                    email: email || null,
                    phone: phone || null,
                    title: title || null,
                    linkedin: linkedin || null,
                    isPrimary: true,
                  },
                },
        },
        select: { id: true, name: true },
      });

      return {
        status: "added" as const,
        companyId: company.id,
        companyName: company.name,
      };
    });
  } catch (err) {
    console.error("create prospect from LinkedIn failed", err);
    return { status: "error", message: "Could not save this prospect. Try again." };
  } finally {
    revalidatePath("/dashboard/companies");
  }
}
