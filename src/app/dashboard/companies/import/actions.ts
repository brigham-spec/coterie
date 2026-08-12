"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { COMPANY_STATUSES } from "@/lib/company-statuses";
import { ACTIVITY_STATUS_CHANGED } from "@/lib/activity";
import {
  parseCsv,
  buildImportRows,
  normalizeCompanyName,
  type ParsedRow,
} from "@/lib/csv-import";

// Admin-only bulk importer for companies + contacts. One CSV row = a contact
// plus their company columns. Both actions parse the SAME raw CSV text (the
// client holds it and re-submits it) so the server stays the source of truth —
// preview never writes, and commit re-parses rather than trusting a client
// payload. Company de-duplication is by normalized name within the tenant;
// contact de-duplication is by email. All writes are stamped with the org from
// context and land inside one withOrg tx (RLS WITH CHECK backstops them).
//
// The gate is an in-action role check (returning an error state) rather than
// requireAdmin's throw, so the result surfaces cleanly through useActionState —
// the same idiom the settings mutations use.

export type SampleState = "create" | "duplicate" | "error";

interface SampleRow {
  line: number;
  companyName: string;
  contactName: string;
  email: string | null;
  state: SampleState;
  error?: string;
}

export type ImportPreview =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "ok";
      companies: {
        name: string;
        state: "new" | "existing";
        status: string;
        contactCount: number;
      }[];
      sample: SampleRow[];
      counts: {
        companiesNew: number;
        companiesExisting: number;
        contactsCreate: number;
        contactsDuplicate: number;
        rowErrors: number;
      };
    };

export type ImportResult =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ok"; companiesCreated: number; contactsCreated: number; contactsSkipped: number };

// Cap the preview table so a thousand-row upload doesn't ship a giant payload;
// the counts above it still reflect the whole file.
const SAMPLE_LIMIT = 50;

function readCsv(formData: FormData): string {
  return String(formData.get("csv") ?? "");
}

export async function previewImport(
  _prev: ImportPreview,
  formData: FormData,
): Promise<ImportPreview> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "admin")
    return { status: "error", message: "Only admins can import." };

  const csv = readCsv(formData);
  if (csv.trim() === "")
    return { status: "error", message: "Paste or upload a CSV first." };

  const { rows, errors } = buildImportRows(parseCsv(csv), {
    validStatuses: COMPANY_STATUSES,
  });
  if (rows.length === 0 && errors.length === 0)
    return { status: "error", message: "No rows found in the CSV." };

  const { existingNames, existingEmails } = await withOrg(ctx.orgId, async (tx) => {
    // Sequential: a withOrg interactive tx holds one pooled connection, so its
    // reads must not run concurrently (no Promise.all).
    const companies = await tx.company.findMany({ select: { name: true } });
    const contacts = await tx.contact.findMany({
      where: { email: { not: null } },
      select: { email: true },
    });
    return {
      existingNames: new Set(companies.map((c) => normalizeCompanyName(c.name))),
      existingEmails: new Set(
        contacts.map((c) => (c.email ?? "").toLowerCase()).filter(Boolean),
      ),
    };
  });

  // First row seen per company name is authoritative for its display fields.
  const companies = new Map<
    string,
    { name: string; state: "new" | "existing"; status: string; contactCount: number }
  >();
  const seenEmails = new Set<string>();
  const sample: SampleRow[] = [];
  let contactsCreate = 0;
  let contactsDuplicate = 0;

  for (const row of rows) {
    const norm = normalizeCompanyName(row.companyName);
    let company = companies.get(norm);
    if (!company) {
      company = {
        name: row.companyName,
        state: existingNames.has(norm) ? "existing" : "new",
        status: row.status,
        contactCount: 0,
      };
      companies.set(norm, company);
    }

    const dup =
      row.email !== null && (existingEmails.has(row.email) || seenEmails.has(row.email));
    if (dup) {
      contactsDuplicate++;
    } else {
      contactsCreate++;
      company.contactCount++;
      if (row.email !== null) seenEmails.add(row.email);
    }

    sample.push({
      line: row.line,
      companyName: row.companyName,
      contactName: row.contactName,
      email: row.email,
      state: dup ? "duplicate" : "create",
    });
  }

  for (const e of errors)
    sample.push({
      line: e.line,
      companyName: "",
      contactName: "",
      email: null,
      state: "error",
      error: e.message,
    });
  sample.sort((a, b) => a.line - b.line);

  const companyList = [...companies.values()];
  return {
    status: "ok",
    companies: companyList,
    sample: sample.slice(0, SAMPLE_LIMIT),
    counts: {
      companiesNew: companyList.filter((c) => c.state === "new").length,
      companiesExisting: companyList.filter((c) => c.state === "existing").length,
      contactsCreate,
      contactsDuplicate,
      rowErrors: errors.length,
    },
  };
}

export async function commitImport(
  _prev: ImportResult,
  formData: FormData,
): Promise<ImportResult> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "admin")
    return { status: "error", message: "Only admins can import." };

  const csv = readCsv(formData);
  if (csv.trim() === "")
    return { status: "error", message: "Paste or upload a CSV first." };

  const { rows } = buildImportRows(parseCsv(csv), { validStatuses: COMPANY_STATUSES });
  if (rows.length === 0)
    return { status: "error", message: "No importable rows found in the CSV." };

  const result = await withOrg(ctx.orgId, async (tx) => {
    // Sequential: one pooled connection per withOrg tx (never Promise.all).
    const companies = await tx.company.findMany({ select: { id: true, name: true } });
    const contacts = await tx.contact.findMany({
      where: { email: { not: null } },
      select: { email: true },
    });

    // Merge existing companies + new ones (assigned an id up front) into one
    // name->id map, so contacts can be linked in the same pass.
    const nameToId = new Map<string, string>();
    for (const c of companies) nameToId.set(normalizeCompanyName(c.name), c.id);

    const seenEmails = new Set(
      contacts.map((c) => (c.email ?? "").toLowerCase()).filter(Boolean),
    );

    const companyData: {
      id: string;
      orgId: string;
      name: string;
      status: string;
      industry: string;
      annualValue: string;
      website: string | null;
    }[] = [];
    const firstRowByNorm = new Map<string, ParsedRow>();

    for (const row of rows) {
      const norm = normalizeCompanyName(row.companyName);
      if (nameToId.has(norm)) continue;
      if (firstRowByNorm.has(norm)) continue;
      firstRowByNorm.set(norm, row);
      const id = randomUUID();
      nameToId.set(norm, id);
      companyData.push({
        id,
        orgId: ctx.orgId,
        name: row.companyName,
        status: row.status,
        industry: row.industry,
        annualValue: row.annualValue,
        website: row.website,
      });
    }

    const contactData: {
      orgId: string;
      companyId: string;
      name: string;
      email: string | null;
      phone: string | null;
      title: string | null;
    }[] = [];
    let contactsSkipped = 0;

    for (const row of rows) {
      const companyId = nameToId.get(normalizeCompanyName(row.companyName));
      if (companyId === undefined) continue; // unreachable — every name is mapped
      if (row.email !== null && seenEmails.has(row.email)) {
        contactsSkipped++;
        continue;
      }
      if (row.email !== null) seenEmails.add(row.email);
      contactData.push({
        orgId: ctx.orgId,
        companyId,
        name: row.contactName !== "" ? row.contactName : (row.email ?? ""),
        email: row.email,
        phone: row.phone,
        title: row.title,
      });
    }

    if (companyData.length > 0) {
      await tx.company.createMany({ data: companyData });
      await tx.activity.createMany({
        data: companyData.map((c) => ({
          orgId: ctx.orgId,
          companyId: c.id,
          actorUserId: ctx.userId,
          type: ACTIVITY_STATUS_CHANGED,
          payload: { from: null, to: c.status },
          occurredAt: new Date(),
        })),
      });
    }
    if (contactData.length > 0) await tx.contact.createMany({ data: contactData });

    return {
      companiesCreated: companyData.length,
      contactsCreated: contactData.length,
      contactsSkipped,
    };
  });

  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/contacts");

  return { status: "ok", ...result };
}
