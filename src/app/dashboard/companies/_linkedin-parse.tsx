"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button, Card, CardHeader, Field } from "@/components/ui";

import {
  createProspectFromLinkedIn,
  parseLinkedInProfileAction,
  type CreateProspectState,
  type LinkedInParseState,
} from "./linkedin-actions";

// Client shell for the LinkedIn-parse helper (gap-audit cluster E). Two steps,
// two server actions: paste text → Parse (the AI seam, key never crosses to the
// browser) → review the extracted fields (editable) → Save as a prospect. The
// parse is ephemeral; only the reviewed Save writes a record.

const parseInitial: LinkedInParseState = { status: "idle" };
const createInitial: CreateProspectState = { status: "idle" };

export function LinkedInParse() {
  const [parseState, parseAction, parsing] = useActionState(
    parseLinkedInProfileAction,
    parseInitial,
  );
  const [createState, createAction, saving] = useActionState(
    createProspectFromLinkedIn,
    createInitial,
  );

  const profile = parseState.status === "ok" ? parseState.profile : null;

  return (
    <Card>
      <CardHeader title="Parse a LinkedIn profile" />
      <form action={parseAction} className="p-4">
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase">
            Profile text
          </span>
          <textarea
            name="profile"
            rows={5}
            required
            placeholder="Open a LinkedIn profile, select all, copy, and paste it here…"
            className="w-full rounded-sm border border-line-2 bg-surface px-3 py-2 text-xs text-ink outline-none focus:border-gold-line"
          />
        </label>
        <div className="mt-3 flex justify-end">
          <Button type="submit" variant="gold" disabled={parsing}>
            {parsing ? "Reading…" : "Parse profile"}
          </Button>
        </div>
      </form>

      {parseState.status === "error" ? (
        <p className="px-4 pb-4 text-xs text-red-600">{parseState.message}</p>
      ) : null}

      {profile ? (
        <form
          action={createAction}
          className="grid grid-cols-2 gap-4 border-t border-line p-4"
        >
          <p className="col-span-2 text-[11px] text-ink-3">
            Review and edit, then save as a prospect.
          </p>
          <Field
            name="org"
            label="Company"
            defaultValue={profile.org}
            required
            className="col-span-2"
          />
          <Field name="name" label="Contact" defaultValue={profile.name} />
          <Field name="title" label="Title" defaultValue={profile.title} />
          <Field name="industry" label="Industry" defaultValue={profile.industry} />
          <Field name="location" label="Location" defaultValue={profile.location} />
          <Field name="email" label="Email" defaultValue={profile.email} />
          <Field name="phone" label="Phone" defaultValue={profile.phone} />
          <Field
            name="linkedin"
            label="LinkedIn"
            defaultValue={profile.linkedin}
            className="col-span-2"
          />
          <Field
            name="website"
            label="Website"
            defaultValue={profile.website}
            className="col-span-2"
          />
          <Field
            name="lookingFor"
            label="Looking for"
            defaultValue={profile.lookingFor}
            className="col-span-2"
          />
          <Field
            name="canOffer"
            label="Can offer"
            defaultValue={profile.canOffer}
            className="col-span-2"
          />
          <label className="col-span-2 block">
            <span className="mb-1 block text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase">
              Notes
            </span>
            <textarea
              name="notes"
              rows={2}
              defaultValue={profile.notes}
              className="w-full rounded-sm border border-line-2 bg-surface px-3 py-2 text-xs text-ink outline-none focus:border-gold-line"
            />
          </label>
          <div className="col-span-2 flex items-center justify-between">
            <span className="text-[11px]">
              {createState.status === "error" ? (
                <span className="text-red-600">{createState.message}</span>
              ) : createState.status === "added" ? (
                <span className="text-ink-2">
                  Saved{" "}
                  <Link
                    href={`/dashboard/companies/${createState.companyId}`}
                    className="text-gold hover:underline"
                  >
                    {createState.companyName}
                  </Link>
                  .
                </span>
              ) : createState.status === "attached" ? (
                <span className="text-ink-2">
                  Added contact to existing{" "}
                  <Link
                    href={`/dashboard/companies/${createState.companyId}`}
                    className="text-gold hover:underline"
                  >
                    {createState.companyName}
                  </Link>
                  .
                </span>
              ) : null}
            </span>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving…" : "Save as prospect"}
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
