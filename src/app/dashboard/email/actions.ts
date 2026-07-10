"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import { fetchEmailCsv } from "@/lib/email-sync";
import {
  isPublishedSheetUrl,
  matchEmailToCompany,
  parseEmailSheet,
  type MatchCompany,
} from "@/lib/email-intel";

// Email Intelligence actions (slice 11.12). syncEmails persists the published
// Google-Sheet URL on the org, fetches its CSV, and lands each analysed row in
// the EmailMessage ledger — matching every row to a company inside the withOrg tx
// (so the assigned company is always same-tenant) and de-duping by externalKey.
// The URL is validated against a docs.google.com allowlist before any fetch, so
// the sheet URL can't be turned into an SSRF probe. deleteEmailMessage drops one
// synced row. syncEmails is useActionState-style so failures render inline.

export type EmailSyncState =
  | { status: "idle" }
  | { status: "ok"; synced: number; matched: number; unmatched: number }
  | { status: "error"; message: string };

export async function syncEmails(
  _prev: EmailSyncState,
  formData: FormData,
): Promise<EmailSyncState> {
  const { orgId } = await requireOrgContext();

  const url = String(formData.get("sheetUrl") ?? "").trim();
  if (url === "")
    return { status: "error", message: "Paste your published Google Sheets CSV URL first." };
  if (!isPublishedSheetUrl(url))
    return {
      status: "error",
      message: "That doesn't look like a published Google Sheets URL (docs.google.com).",
    };

  // Persist the URL up front so a later fetch failure still leaves it saved.
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  });
  const settings =
    org?.settings && typeof org.settings === "object" && !Array.isArray(org.settings)
      ? (org.settings as Record<string, unknown>)
      : {};
  await prisma.organization.update({
    where: { id: orgId },
    data: { settings: { ...settings, emailSheetUrl: url } },
  });

  let rows: ReturnType<typeof parseEmailSheet>;
  try {
    const csv = await fetchEmailCsv(url);
    rows = parseEmailSheet(csv);
  } catch (err) {
    console.error("email sheet fetch failed", err);
    return {
      status: "error",
      message: "Could not read the sheet. Confirm it's published to the web as CSV.",
    };
  }

  if (rows.length === 0)
    return {
      status: "error",
      message: "No email rows found. Confirm the sheet is published and Zapier has written rows.",
    };

  try {
    const syncedAt = new Date();
    return await withOrg(orgId, async (tx) => {
      const companies = await tx.company.findMany({
        where: { status: { not: "former" } },
        select: {
          id: true,
          name: true,
          contacts: { select: { name: true, email: true } },
        },
      });
      const matchable: MatchCompany[] = companies.map((c) => ({
        id: c.id,
        name: c.name,
        contactEmails: c.contacts.map((k) => k.email ?? "").filter(Boolean),
        contactNames: c.contacts.map((k) => k.name),
      }));

      let matched = 0;
      // Sequential upserts — one pooled connection per withOrg tx (never Promise.all).
      for (const row of rows) {
        const companyId = matchEmailToCompany(row, matchable);
        if (companyId !== null) matched++;
        await tx.emailMessage.upsert({
          where: { orgId_externalKey: { orgId, externalKey: row.externalKey } },
          create: {
            orgId,
            companyId,
            externalKey: row.externalKey,
            fromName: row.fromName,
            fromEmail: row.fromEmail,
            subject: row.subject,
            summary: row.summary,
            projects: row.projects,
            actionItems: row.actionItems,
            sentiment: row.sentiment,
            emailDate: row.emailDate,
            syncedAt,
          },
          update: {
            companyId,
            fromName: row.fromName,
            fromEmail: row.fromEmail,
            subject: row.subject,
            summary: row.summary,
            projects: row.projects,
            actionItems: row.actionItems,
            sentiment: row.sentiment,
            emailDate: row.emailDate,
            syncedAt,
          },
        });
      }

      return {
        status: "ok" as const,
        synced: rows.length,
        matched,
        unmatched: rows.length - matched,
      };
    });
  } catch (err) {
    console.error("email sync failed", err);
    return { status: "error", message: "Could not save synced emails. Try again." };
  } finally {
    revalidatePath("/dashboard/email");
  }
}

export async function deleteEmailMessage(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const id = String(formData.get("id") ?? "").trim();
  if (id === "") throw new Error("email required");

  await withOrg(orgId, (tx) => tx.emailMessage.deleteMany({ where: { id } }));
  revalidatePath("/dashboard/email");
}
