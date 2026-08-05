"use client";

import { useState } from "react";

import { Card, CardHeader } from "@/components/ui";

import { updateContact } from "../actions";
import { ContactForm, type ContactRow } from "../_contact-form";

// Editable Details card for the standalone contact page (Members 5). The page
// used to render these fields read-only; this toggles the same read view into
// the shared ContactForm (driven by updateContact, the same action the company-
// profile Contacts card uses — one editor, no drift). Local state is only which
// mode is showing; a successful save revalidates the page and closes the form.

export function ContactDetails({ contact }: { contact: ContactRow }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <Card>
        <CardHeader title="Details" />
        <div className="p-4">
          <ContactForm
            action={updateContact}
            hidden={{ contactId: contact.id }}
            defaults={contact}
            submitLabel="Save changes"
            onDone={() => setEditing(false)}
          />
        </div>
      </Card>
    );
  }

  const facts: Array<{ label: string; value: string | null }> = [
    { label: "Title", value: contact.title },
    { label: "Email", value: contact.email },
    { label: "Phone", value: contact.phone },
  ];

  return (
    <Card>
      <CardHeader
        title="Details"
        action={
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
          >
            Edit
          </button>
        }
      />
      <dl className="grid grid-cols-2 gap-4 p-4 text-xs sm:grid-cols-3">
        {facts.map((f) => (
          <div key={f.label}>
            <dt className="mb-1 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
              {f.label}
            </dt>
            <dd className="text-ink">{f.value ?? "—"}</dd>
          </div>
        ))}
        <div>
          <dt className="mb-1 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
            LinkedIn
          </dt>
          <dd className="text-ink">
            {contact.linkedin ? (
              <a
                href={contact.linkedin}
                target="_blank"
                rel="noreferrer"
                className="text-gold hover:underline"
              >
                Profile
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>
      {contact.additionalEmails.length > 0 ? (
        <div className="border-t border-line px-4 py-3">
          <div className="mb-1 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
            Additional emails
          </div>
          <p className="text-xs text-ink-2">{contact.additionalEmails.join(", ")}</p>
        </div>
      ) : null}
      {contact.notes ? (
        <div className="border-t border-line px-4 py-3">
          <div className="mb-1 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
            Notes
          </div>
          <p className="text-xs whitespace-pre-wrap text-ink-2">{contact.notes}</p>
        </div>
      ) : null}
    </Card>
  );
}
