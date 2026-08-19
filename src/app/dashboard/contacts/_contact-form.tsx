"use client";

import { useRef, useState } from "react";

import { Button, Field, Textarea } from "@/components/ui";
import {
  findContactDuplicate,
  normalizeName,
  type ExistingContact,
} from "@/lib/duplicate-check";
import { CONTACT_TAGS } from "@/lib/tags";

// Shared contact editor (add / edit). Extracted so both the company-profile
// Contacts card and the standalone contact detail page (Members 5) drive the
// same fields through the same withOrg-scoped actions — one form, no drift. The
// form holds no state of its own beyond the browser's; the caller supplies the
// action, the hidden keys (companyId for create, contactId for update), the
// row's current values (defaults) for an edit, and an onDone that runs after a
// successful save so the caller can close the editor.
//
// When `existing` is supplied (the add path only), the form shows the same
// lightweight, non-blocking duplicate warning as the standalone add page: the
// first submit of a likely-duplicate is intercepted and a second submit lets it
// through. Edit callers omit `existing`, so there's no warning on edit.

// Signature that identifies "the same submission we already warned about". Keyed
// on the three fields the dup rule reads, so editing any of them re-arms.
function signatureOf(name: string, companyId: string, email: string): string {
  return `${normalizeName(name)}|${companyId}|${email.trim().toLowerCase()}`;
}

export type ContactRow = {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  additionalEmails: string[];
  phone: string | null;
  linkedin: string | null;
  notes: string;
  tags: string[];
  isPrimary: boolean;
};

export function ContactForm({
  action,
  hidden,
  defaults,
  submitLabel,
  onDone,
  existing,
}: {
  action: (formData: FormData) => Promise<void>;
  hidden: Record<string, string>;
  defaults?: ContactRow;
  submitLabel: string;
  onDone: () => void;
  existing?: ExistingContact[];
}) {
  const tagSet = new Set(defaults?.tags ?? []);
  const [duplicate, setDuplicate] = useState<ExistingContact | null>(null);
  const acknowledged = useRef<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!existing) return;
    const data = new FormData(e.currentTarget);
    const name = String(data.get("name") ?? "");
    const companyId = hidden.companyId ?? "";
    const email = String(data.get("email") ?? "");
    const sig = signatureOf(name, companyId, email);
    const match = findContactDuplicate(
      { name, companyId, email: email.trim() === "" ? null : email },
      existing,
    );
    if (match && acknowledged.current !== sig) {
      e.preventDefault();
      acknowledged.current = sig;
      setDuplicate(match);
      return;
    }
    setDuplicate(null);
  }

  return (
    <form
      onSubmit={handleSubmit}
      action={async (fd) => {
        await action(fd);
        onDone();
      }}
      className="flex flex-col gap-4"
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <div className="grid grid-cols-2 gap-4">
        <Field name="name" label="Name" defaultValue={defaults?.name ?? ""} required />
        <Field name="title" label="Title" defaultValue={defaults?.title ?? ""} />
        <Field
          name="email"
          label="Email"
          type="email"
          defaultValue={defaults?.email ?? ""}
        />
        <Field name="phone" label="Phone" defaultValue={defaults?.phone ?? ""} />
        <Field
          name="linkedin"
          label="LinkedIn"
          defaultValue={defaults?.linkedin ?? ""}
          className="col-span-2"
        />
        <Field
          name="additionalEmails"
          label="Additional emails (comma-separated)"
          defaultValue={defaults?.additionalEmails.join(", ") ?? ""}
          className="col-span-2"
        />
      </div>

      <Textarea name="notes" label="Notes" defaultValue={defaults?.notes ?? ""} />

      <div>
        <span className="mb-1.5 block text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase">
          Tags
        </span>
        <div className="flex flex-wrap gap-2">
          {CONTACT_TAGS.map((t) => (
            <label
              key={t.key}
              title={t.desc}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-line-2 bg-surface px-2.5 py-1 text-[11px] text-ink-2 has-[:checked]:border-gold-line has-[:checked]:bg-gold-bg has-[:checked]:text-gold-ink"
            >
              <input
                type="checkbox"
                name="tags"
                value={t.key}
                defaultChecked={tagSet.has(t.key)}
                className="sr-only"
              />
              {t.label}
            </label>
          ))}
        </div>
      </div>

      {duplicate ? (
        <p className="rounded-sm border border-gold-line bg-gold-bg px-3 py-2 text-[11px] text-gold-ink">
          {duplicate.email
            ? `A contact with that email (${duplicate.email}) is already in your network`
            : `A contact named “${duplicate.name}” is already at this company`}
          {duplicate.companyName ? ` — ${duplicate.companyName}` : ""}. Submit
          again to add this one anyway.
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
