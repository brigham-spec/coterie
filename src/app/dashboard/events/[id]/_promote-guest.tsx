"use client";

import { useState } from "react";

import { Button } from "@/components/ui";

import { promoteInviteeToContact } from "../actions";

// "Add to network" affordance on an external guest row. Collapsed it's a link;
// expanded it asks only for the guest's company (prefilled from the stored org,
// with a datalist of existing companies rendered once on the page) — the guest's
// name/email/title already live on the invitee and seed the new contact. On
// success the invitee becomes a real network contact, so it appears in the
// introduction and follow-up pickers. Validation errors render inline.

export function PromoteGuest({
  inviteeId,
  eventId,
  defaultCompany,
}: {
  inviteeId: string;
  eventId: string;
  defaultCompany: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-ink-3 hover:text-gold"
      >
        Add to network
      </button>
    );
  }

  return (
    <form
      action={async (fd) => {
        setError(null);
        const result = await promoteInviteeToContact(fd);
        if (result.status === "error") {
          setError(result.message);
          return;
        }
        setOpen(false);
      }}
      className="flex flex-col gap-1"
    >
      <input type="hidden" name="inviteeId" value={inviteeId} />
      <input type="hidden" name="eventId" value={eventId} />
      <div className="flex items-center gap-1">
        <input
          name="companyName"
          defaultValue={defaultCompany}
          required
          placeholder="Company"
          list="promote-company-names"
          className="w-32 rounded-sm border border-line-2 bg-surface px-2 py-1 text-[11px] text-ink outline-none focus:border-gold-line"
        />
        <Button type="submit">Add</Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-ink-3 hover:text-ink"
        >
          Cancel
        </button>
      </div>
      {error ? <p className="text-[10px] text-red-ink">{error}</p> : null}
    </form>
  );
}
