"use client";

import { Button, Field, Textarea } from "@/components/ui";
import { CONTACT_TAGS } from "@/lib/tags";

// Shared contact editor (add / edit). Extracted so both the company-profile
// Contacts card and the standalone contact detail page (Members 5) drive the
// same fields through the same withOrg-scoped actions — one form, no drift. The
// form holds no state of its own beyond the browser's; the caller supplies the
// action, the hidden keys (companyId for create, contactId for update), the
// row's current values (defaults) for an edit, and an onDone that runs after a
// successful save so the caller can close the editor.

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
}: {
  action: (formData: FormData) => Promise<void>;
  hidden: Record<string, string>;
  defaults?: ContactRow;
  submitLabel: string;
  onDone: () => void;
}) {
  const tagSet = new Set(defaults?.tags ?? []);

  return (
    <form
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
