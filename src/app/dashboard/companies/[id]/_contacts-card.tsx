"use client";

import Link from "next/link";
import { useState } from "react";

import { CollapsibleCard } from "@/components/collapsible-card";
import { getTagDef } from "@/lib/tags";

import {
  createContact,
  updateContact,
  removeContact,
  setPrimaryContact,
} from "@/app/dashboard/contacts/actions";
import { ContactForm, type ContactRow } from "@/app/dashboard/contacts/_contact-form";
import type { ExistingContact } from "@/lib/duplicate-check";

// Editable Contacts card (profile-parity P2). The company detail page was
// read-only; this owns the add/edit/remove/set-primary surface for the firm's
// people, mirroring the prototype's in-modal contact editing. All writes go
// through the withOrg-scoped contact actions — this holds only local UI state
// (which row is open, whether the add form is showing). After a successful save
// the server revalidates and the open form closes. The row editor itself lives
// in the shared _contact-form module (also used by the standalone contact page).

export function ContactsCard({
  companyId,
  contacts,
  existing,
}: {
  companyId: string;
  contacts: ContactRow[];
  existing: ExistingContact[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <CollapsibleCard
      id="company-contacts"
      title="Contacts"
      action={
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
        >
          {adding ? "Close" : "Add"}
        </button>
      }
    >
      {adding ? (
        <div className="border-b border-line p-4">
          <ContactForm
            action={createContact}
            hidden={{ companyId }}
            submitLabel="Add contact"
            onDone={() => setAdding(false)}
            existing={existing}
          />
        </div>
      ) : null}

      {contacts.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          No contacts yet. Use “Add” to create the first one.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {contacts.map((c) => (
            <ContactItem key={c.id} contact={c} />
          ))}
        </ul>
      )}
    </CollapsibleCard>
  );
}

function ContactItem({ contact }: { contact: ContactRow }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="p-4">
        <ContactForm
          action={updateContact}
          hidden={{ contactId: contact.id }}
          defaults={contact}
          submitLabel="Save changes"
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            href={`/dashboard/contacts/${contact.id}`}
            className="text-xs font-medium text-ink hover:text-gold hover:underline"
          >
            {contact.name}
          </Link>
          {contact.isPrimary ? (
            <span className="ml-2 text-[10px] font-medium tracking-[0.06em] text-gold uppercase">
              Primary
            </span>
          ) : null}
          {contact.linkedin ? (
            <a
              href={contact.linkedin}
              target="_blank"
              rel="noreferrer"
              className="ml-2 text-[10px] text-ink-3 hover:text-gold hover:underline"
            >
              LinkedIn
            </a>
          ) : null}
          <div className="mt-0.5 text-[11px] text-ink-3">
            {[contact.title, contact.email, contact.phone]
              .filter(Boolean)
              .join(" · ") || "No details yet"}
          </div>
          {contact.additionalEmails.length > 0 ? (
            <div className="mt-0.5 text-[10px] text-ink-3">
              Also: {contact.additionalEmails.join(", ")}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!contact.isPrimary ? (
            <form action={setPrimaryContact}>
              <input type="hidden" name="contactId" value={contact.id} />
              <button
                type="submit"
                className="text-[10px] font-medium tracking-[0.06em] text-ink-3 uppercase hover:text-gold hover:underline"
              >
                Make primary
              </button>
            </form>
          ) : null}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
          >
            Edit
          </button>
          <form action={removeContact}>
            <input type="hidden" name="contactId" value={contact.id} />
            <button
              type="submit"
              className="text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
            >
              Remove
            </button>
          </form>
        </div>
      </div>

      {contact.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {contact.tags.map((key) => {
            const def = getTagDef(key);
            return (
              <span
                key={key}
                title={def.desc}
                className="rounded-sm border border-line-2 bg-surface px-2 py-0.5 text-[10px] text-ink-2"
              >
                {def.label}
              </span>
            );
          })}
        </div>
      ) : null}

      {contact.notes ? (
        <p className="text-xs whitespace-pre-wrap text-ink-2">{contact.notes}</p>
      ) : null}
    </li>
  );
}
