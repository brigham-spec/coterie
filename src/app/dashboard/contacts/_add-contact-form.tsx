"use client";

import { useRef, useState } from "react";

import { Button, Field, SelectField } from "@/components/ui";
import {
  findContactDuplicate,
  normalizeName,
  type ExistingContact,
} from "@/lib/duplicate-check";

import { createContact } from "./actions";

// Add-contact form with a lightweight, non-blocking duplicate warning. The
// server action (createContact) is unchanged — this only intercepts the FIRST
// submit when the typed email already exists in the org, or the same name is
// already at the chosen company, shows an inline warning, and lets a second
// submit through. The check runs against the contacts list already loaded by
// the page, so there's no extra round-trip.

// Signature that identifies "the same submission we already warned about". Keyed
// on the three fields the dup rule reads, so editing any of them re-arms.
function signatureOf(name: string, companyId: string, email: string): string {
  return `${normalizeName(name)}|${companyId}|${email.trim().toLowerCase()}`;
}

export function AddContactForm({
  companies,
  existing,
}: {
  companies: { id: string; name: string }[];
  existing: ExistingContact[];
}) {
  const [duplicate, setDuplicate] = useState<ExistingContact | null>(null);
  const acknowledged = useRef<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const data = new FormData(e.currentTarget);
    const name = String(data.get("name") ?? "");
    const companyId = String(data.get("companyId") ?? "");
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
      action={createContact}
      onSubmit={handleSubmit}
      className="grid grid-cols-2 gap-4 p-4"
    >
      <SelectField
        name="companyId"
        label="Company"
        defaultValue=""
        required
        className="col-span-2"
      >
        <option value="" disabled>
          Select a company…
        </option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <Field name="name" label="Name" placeholder="Jane Doe" required />
      <Field name="title" label="Title" placeholder="VP, Operations" />
      <Field
        name="email"
        label="Email"
        type="email"
        placeholder="jane@acme.com"
      />
      <Field name="phone" label="Phone" placeholder="(555) 010-0100" />
      {duplicate ? (
        <p className="col-span-2 rounded-sm border border-gold-line bg-gold-bg px-3 py-2 text-[11px] text-gold-ink">
          {duplicate.email
            ? `A contact with that email (${duplicate.email}) is already in your network`
            : `A contact named “${duplicate.name}” is already at this company`}
          {duplicate.companyName ? ` — ${duplicate.companyName}` : ""}. Submit
          again to add this one anyway.
        </p>
      ) : null}
      <div className="col-span-2 flex justify-end">
        <Button type="submit" variant="primary">
          Add contact
        </Button>
      </div>
    </form>
  );
}
