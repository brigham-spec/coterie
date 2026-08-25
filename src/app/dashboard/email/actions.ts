"use server";

import { revalidatePath } from "next/cache";

import Anthropic from "@anthropic-ai/sdk";

import { requireOrgContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import { fetchEmailCsv } from "@/lib/email-sync";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import {
  isPublishedSheetUrl,
  matchEmailToCompany,
  parseEmailSheet,
  toMatchCompany,
  type EmailRow,
  type MatchCompany,
} from "@/lib/email-intel";
import {
  generateEmailThreadExtraction,
  parseEmailThreadExtraction,
  type EmailThreadExtraction,
} from "@/lib/extract-email-thread";

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
      const matchable: MatchCompany[] = companies.map(toMatchCompany);

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

// ── Paste-a-thread → meeting note (Email audit items 8 + 10) ──────────────────
// The org-level sibling of the company-profile paste flow: the operator pastes a
// raw thread on the inbox, Claude reads it into a meeting-shaped note (see
// @/lib/extract-email-thread), we match the SENDER to an existing company
// deterministically (never a model-returned id), review, then save. A matched
// sender's meeting lands on that company; an unmatched sender becomes a new
// prospect. Any genuinely new organisations the thread surfaced are created as
// extra prospects. Every lookup and write is RLS-scoped by withOrg.

// PURE: match the extracted sender to a company using the same deterministic rules
// as the sheet sync (exact contact email, then company/contact name words). Feeds
// matchEmailToCompany an EmailRow built from just the sender fields.
function matchSender(
  extraction: EmailThreadExtraction,
  matchable: MatchCompany[],
): string | null {
  const row: EmailRow = {
    externalKey: "",
    emailDate: "",
    fromName: extraction.primaryContact.name,
    fromEmail: extraction.primaryContact.email,
    subject: "",
    memberMatch: extraction.primaryContact.name,
    orgMatch: extraction.primaryContact.org,
    summary: "",
    projects: "",
    actionItems: "",
    sentiment: "",
  };
  return matchEmailToCompany(row, matchable);
}

export type ExtractThreadState =
  | { status: "idle" }
  | {
      status: "ok";
      extraction: EmailThreadExtraction;
      matchedCompany: { id: string; name: string } | null;
    }
  | { status: "error"; message: string };

export async function extractEmailThread(
  _prev: ExtractThreadState,
  formData: FormData,
): Promise<ExtractThreadState> {
  const { orgId, orgName } = await requireOrgContext();

  const thread = String(formData.get("thread") ?? "").trim();
  if (thread === "")
    return { status: "error", message: "Paste an email thread first." };

  const companies = await withOrg(orgId, (tx) =>
    tx.company.findMany({
      where: { status: { not: "former" } },
      select: {
        id: true,
        name: true,
        contacts: { select: { name: true, email: true } },
      },
    }),
  );
  const matchable: MatchCompany[] = companies.map(toMatchCompany);

  try {
    await enforceAiRateLimit(orgId);
    const extraction = await generateEmailThreadExtraction(
      { orgName, memberOrgs: companies.map((c) => c.name) },
      thread,
    );
    if (extraction === null)
      return { status: "error", message: "Could not read that email thread." };

    const matchedId = matchSender(extraction, matchable);
    const matchedCompany = matchedId
      ? { id: matchedId, name: companies.find((c) => c.id === matchedId)!.name }
      : null;
    return { status: "ok", extraction, matchedCompany };
  } catch (err) {
    console.error("email thread extraction failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not read that email thread. Try again." };
  }
}

export type SaveThreadState =
  | { status: "idle" }
  // `savedSummary` echoes the saved draft's summary so the client can tell a NEW
  // extraction apart from the one it just saved (and re-open the review panel).
  | { status: "saved"; companyId: string; savedSummary: string }
  | { status: "error"; message: string };

// Persist the reviewed thread as a Meeting. Re-matches the sender server-side (the
// single source of truth — the client can't smuggle a company id), resolving OR
// creating the target company, then creates one Meeting attributed to that
// company via a manual attendee. Action items + key insights fold into the
// summary (a Meeting has no free-text action-item field, and forging ActionItem
// rows with arbitrary owners would be wrong). Newly-surfaced organisations become
// extra prospects, deduped by name.
export async function saveEmailThread(
  _prev: SaveThreadState,
  formData: FormData,
): Promise<SaveThreadState> {
  const { orgId } = await requireOrgContext();

  const raw = String(formData.get("extraction") ?? "");
  const extraction = parseEmailThreadExtraction(raw);
  if (extraction === null)
    return { status: "error", message: "Nothing to save." };

  const contactName =
    extraction.primaryContact.name.trim() ||
    extraction.primaryContact.org.trim() ||
    "Contact";
  const contactEmail = extraction.primaryContact.email.trim() || null;
  const contactTitle = extraction.primaryContact.title.trim() || null;

  const title = extraction.meetingTitle.trim() || "Email thread";
  const parsedDate = new Date(extraction.meetingDate);
  const heldAt =
    extraction.meetingDate !== "" && !Number.isNaN(parsedDate.getTime())
      ? parsedDate
      : new Date();
  const summaryParts = [
    extraction.summary,
    extraction.actionItems ? `Action items: ${extraction.actionItems}` : "",
    extraction.keyInsights ? `Key insights: ${extraction.keyInsights}` : "",
  ].filter(Boolean);
  const meetingSummary = summaryParts.join("\n\n") || null;

  let result: { companyId: string } | string;
  try {
    result = await withOrg(orgId, async (tx) => {
      const companies = await tx.company.findMany({
        select: {
          id: true,
          name: true,
          status: true,
          contacts: {
            select: { id: true, name: true, email: true, isPrimary: true },
          },
        },
      });
      const existingNames = new Set(companies.map((c) => c.name.toLowerCase()));
      const matchable: MatchCompany[] = companies
        .filter((c) => c.status !== "former")
        .map(toMatchCompany);

      const matchedId = matchSender(extraction, matchable);

      let targetCompanyId: string;
      let attendeeContactId: string;
      if (matchedId !== null) {
        const c = companies.find((x) => x.id === matchedId)!;
        targetCompanyId = c.id;
        const primary = c.contacts.find((k) => k.isPrimary) ?? c.contacts[0];
        if (primary) {
          attendeeContactId = primary.id;
        } else {
          // A name-word match can land on a company with no contacts on file —
          // record the sender as one so the meeting has an attendee to hang on.
          const created = await tx.contact.create({
            data: {
              orgId,
              companyId: c.id,
              name: contactName,
              email: contactEmail,
              title: contactTitle,
              isPrimary: true,
            },
            select: { id: true },
          });
          attendeeContactId = created.id;
        }
      } else {
        const companyName =
          extraction.primaryContact.org.trim() ||
          extraction.primaryContact.name.trim();
        if (companyName === "")
          return "Could not tell who this email is from.";
        const created = await tx.company.create({
          data: {
            orgId,
            name: companyName,
            status: "prospect",
            industry: "Other",
            annualValue: "0",
            source: "Email thread",
            contacts: {
              create: {
                orgId,
                name: contactName,
                email: contactEmail,
                title: contactTitle,
                isPrimary: true,
              },
            },
          },
          select: { id: true, contacts: { select: { id: true } } },
        });
        targetCompanyId = created.id;
        attendeeContactId = created.contacts[0].id;
        existingNames.add(companyName.toLowerCase());
      }

      await tx.meeting.create({
        data: {
          orgId,
          title,
          heldAt,
          summary: meetingSummary,
          attendees: {
            create: {
              contactId: attendeeContactId,
              matchMethod: "manual",
              confidence: 1,
              confirmed: true,
            },
          },
        },
      });
      // Forward-only — a backdated thread must never roll a company's clock
      // backwards past a more recent touch (matches meetings + Fireflies sync).
      await tx.company.updateMany({
        where: {
          id: targetCompanyId,
          OR: [{ lastContactAt: null }, { lastContactAt: { lt: heldAt } }],
        },
        data: { lastContactAt: heldAt },
      });

      // Extra prospects the thread surfaced — skip any name already tracked.
      for (const p of extraction.newProspects) {
        const name = p.org.trim() || p.name.trim();
        if (name === "" || existingNames.has(name.toLowerCase())) continue;
        existingNames.add(name.toLowerCase());
        await tx.company.create({
          data: {
            orgId,
            name,
            status: "prospect",
            industry: "Other",
            annualValue: "0",
            source: "Email thread",
            notes: p.notes,
            contacts: p.name.trim()
              ? {
                  create: {
                    orgId,
                    name: p.name.trim(),
                    email: p.email.trim() || null,
                    isPrimary: true,
                  },
                }
              : undefined,
          },
        });
      }

      return { companyId: targetCompanyId };
    });
  } catch (err) {
    console.error("save email thread failed", err);
    return { status: "error", message: "Could not save this thread. Try again." };
  }

  if (typeof result === "string") return { status: "error", message: result };

  revalidatePath("/dashboard/email");
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/meetings");
  revalidatePath(`/dashboard/companies/${result.companyId}`);
  return {
    status: "saved",
    companyId: result.companyId,
    savedSummary: extraction.summary,
  };
}
