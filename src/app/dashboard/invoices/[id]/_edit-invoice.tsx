"use client";

import { useActionState } from "react";

import { AddDisclosure, Button, Field, SelectField } from "@/components/ui";

import { editInvoice, type EditInvoiceState } from "../actions";

// Edit-invoice form on the invoice detail page — the seat the company profile's
// invoice-schedule card links to when a member's billing cadence needs to change
// (a wrong due date, a corrected amount). Mirrors the create-invoice fields,
// prefilled from the current invoice, with an inline Saved/error confirmation via
// useActionState. Not rendered for voided invoices (those are frozen).

export type EditInvoiceFields = {
  id: string;
  invoiceNumber: string;
  amount: string;
  issuedOn: string; // yyyy-mm-dd
  dueOn: string; // yyyy-mm-dd
  status: string;
  notes: string;
};

const initialState: EditInvoiceState = { status: "idle" };

export function EditInvoice({ invoice }: { invoice: EditInvoiceFields }) {
  const [state, formAction, isPending] = useActionState(
    editInvoice,
    initialState,
  );

  return (
    <AddDisclosure label="Edit invoice" className="border-t border-line">
      <form
        action={formAction}
        className="grid grid-cols-2 gap-4 border-t border-line p-4"
      >
        <input type="hidden" name="invoiceId" value={invoice.id} />
        <Field
          name="invoiceNumber"
          label="Invoice number"
          defaultValue={invoice.invoiceNumber}
          required
        />
        <Field
          name="amount"
          label="Amount (USD)"
          inputMode="decimal"
          defaultValue={invoice.amount}
          required
        />
        <Field
          name="issuedOn"
          label="Issued on"
          type="date"
          defaultValue={invoice.issuedOn}
          required
        />
        <Field
          name="dueOn"
          label="Due on"
          type="date"
          defaultValue={invoice.dueOn}
          required
        />
        <SelectField
          name="status"
          label="Status"
          defaultValue={invoice.status === "sent" ? "sent" : "draft"}
        >
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
        </SelectField>
        <Field
          name="notes"
          label="Notes (optional)"
          defaultValue={invoice.notes}
          placeholder="Membership dues, Q3"
          className="col-span-2"
        />
        <div className="col-span-2 flex items-center justify-end gap-3">
          {state.status === "saved" ? (
            <span className="text-xs text-teal-ink">Saved.</span>
          ) : null}
          {state.status === "error" ? (
            <span className="text-xs text-red-ink">{state.message}</span>
          ) : null}
          <Button type="submit" variant="primary" disabled={isPending}>
            {isPending ? "Saving…" : "Save invoice"}
          </Button>
        </div>
      </form>
    </AddDisclosure>
  );
}
