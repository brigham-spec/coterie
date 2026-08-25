"use client";

import { useRef, useState } from "react";

import { Button, Field, SelectField } from "@/components/ui";
import { COMPANY_STATUS_DEFS } from "@/lib/company-statuses";
import {
  findCompanyDuplicate,
  normalizeName,
  type ExistingCompany,
} from "@/lib/duplicate-check";

import { createCompany } from "./actions";

// Add-company form with a lightweight, non-blocking duplicate warning. The
// server action (createCompany) is unchanged — this only intercepts the FIRST
// submit when the typed name already matches a company in the org, shows an
// inline warning, and lets a second submit through. The check runs against the
// companies list already loaded by the page, so there's no extra round-trip.

export function AddCompanyForm({
  existing,
  industries,
}: {
  existing: ExistingCompany[];
  industries: string[];
}) {
  const [duplicate, setDuplicate] = useState<ExistingCompany | null>(null);
  // The normalized name we've already warned about; a matching second submit is
  // allowed through. Re-typing a different name re-arms the warning.
  const acknowledged = useRef<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const name = String(new FormData(e.currentTarget).get("name") ?? "");
    const norm = normalizeName(name);
    const match = findCompanyDuplicate(name, existing);
    if (match && acknowledged.current !== norm) {
      e.preventDefault();
      acknowledged.current = norm;
      setDuplicate(match);
      return;
    }
    setDuplicate(null);
  }

  return (
    <form
      action={createCompany}
      onSubmit={handleSubmit}
      className="grid grid-cols-2 gap-4 border-t border-line p-4"
    >
      <Field
        name="name"
        label="Company name"
        placeholder="Acme Corp"
        required
        className="col-span-2"
      />
      {duplicate ? (
        <p className="col-span-2 rounded-sm border border-gold-line bg-gold-bg px-3 py-2 text-[11px] text-gold-ink">
          A company named “{duplicate.name}” is already in your network. Submit
          again to add this one anyway.
        </p>
      ) : null}
      <SelectField name="status" label="Status" defaultValue="prospect">
        {COMPANY_STATUS_DEFS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </SelectField>
      <Field
        name="industry"
        label="Industry"
        placeholder="Manufacturing"
        list="company-industries"
        required
      />
      <datalist id="company-industries">
        {industries.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <Field
        name="annualValue"
        label="Annual value (USD)"
        placeholder="0"
        inputMode="decimal"
      />
      <div className="col-span-2 flex justify-end">
        <Button type="submit" variant="primary">
          Add company
        </Button>
      </div>
    </form>
  );
}
