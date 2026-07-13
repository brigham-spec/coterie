"use client";

import { useActionState, useState } from "react";

import { Button, Card } from "@/components/ui";

import { syncEmails, type EmailSyncState } from "./actions";

// Email Intelligence connection panel (slice 11.12). A client shell over the
// syncEmails server action: paste the published Google-Sheet CSV URL, sync, and
// see how many rows landed and matched. A collapsible guide walks through the
// one-time Zapier + Sheet wiring the feed depends on.

const initialState: EmailSyncState = { status: "idle" };

const SHEET_HEADERS =
  "date | from_name | from_email | subject | member_match | org_match | summary | projects | action_items | sentiment | thread_id";

const GUIDE_STEPS: { title: string; body: string }[] = [
  {
    title: "1. Create the Google Sheet",
    body: 'Make a new sheet named "Email Intelligence". Paste the header row below into row 1, then File → Share → Publish to web → CSV → Publish, and copy that URL.',
  },
  {
    title: "2. Create a Zap",
    body: "In Zapier, trigger on New Email (Outlook or Gmail). Point it at your inbox or a filtered client folder.",
  },
  {
    title: "3. Analyse with Claude",
    body: 'Add a Webhooks by Zapier → POST to https://api.anthropic.com/v1/messages. Ask Claude (haiku) to return JSON with member_match, org_match, summary, projects, action_items, and sentiment for the email body.',
  },
  {
    title: "4. Append a row",
    body: "Add Google Sheets → Create Spreadsheet Row. Map the email fields plus Claude's parsed JSON into the columns. Test, then publish the Zap.",
  },
  {
    title: "5. Sync here",
    body: "Paste your published CSV URL above and click Sync now. Emails appear grouped by company below.",
  },
];

export function EmailSync({
  savedUrl,
  lastSync,
}: {
  savedUrl: string;
  lastSync: string | null;
}) {
  const [url, setUrl] = useState(savedUrl);
  const [showGuide, setShowGuide] = useState(false);
  const [state, formAction, isPending] = useActionState(syncEmails, initialState);

  // Pin UTC so the server-rendered label and the client hydration match (an
  // unpinned zone renders differently on each side and trips a hydration warning).
  const lastSyncLabel = lastSync
    ? new Date(lastSync).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
      })
    : null;

  return (
    <div className="mb-5 mt-4">
      <Card>
        <div className="space-y-3 p-4">
          <div className="text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
            Google Sheet connection
          </div>

          <form action={formAction} className="flex gap-2">
            <input
              type="text"
              name="sheetUrl"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste your published Google Sheets CSV URL"
              className="min-w-0 flex-1 rounded-sm border border-line-2 bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-gold-line"
            />
            <Button type="submit" variant="gold" disabled={isPending}>
              {isPending ? "Syncing…" : "Sync now"}
            </Button>
          </form>

          <p className="text-[11px] leading-relaxed text-ink-3">
            Paste the <span className="font-medium text-ink-2">Published CSV URL</span>{" "}
            from your sheet (File → Share → Publish to web → CSV). Zapier writes
            analysed emails there automatically.
          </p>

          {isPending ? (
            <p className="text-[11px] text-ink-3 italic">
              Reading the sheet · matching to your network…
            </p>
          ) : state.status === "error" ? (
            <p className="text-[11px] text-red-600">{state.message}</p>
          ) : state.status === "ok" ? (
            <p className="text-[11px] text-teal-ink">
              Synced {state.synced} email{state.synced === 1 ? "" : "s"} ·{" "}
              {state.matched} matched · {state.unmatched} unmatched.
            </p>
          ) : lastSyncLabel ? (
            <p className="text-[10px] text-ink-3">Last synced: {lastSyncLabel}</p>
          ) : null}

          <button
            type="button"
            onClick={() => setShowGuide((s) => !s)}
            className="text-[11px] text-gold hover:underline"
          >
            {showGuide ? "Hide" : "Show"} Zapier setup guide
          </button>

          {showGuide ? (
            <div className="space-y-3 rounded-md border border-line bg-surface-2 p-3.5">
              <div>
                <div className="text-[10px] font-medium text-ink-2">
                  Sheet header row (copy exactly):
                </div>
                <code className="mt-1 block overflow-x-auto rounded-sm bg-surface px-2 py-1.5 text-[10px] text-ink-2">
                  {SHEET_HEADERS}
                </code>
              </div>
              <ol className="space-y-2">
                {GUIDE_STEPS.map((s) => (
                  <li key={s.title}>
                    <div className="text-[11.5px] font-medium text-ink">{s.title}</div>
                    <div className="text-[11px] leading-relaxed text-ink-2">{s.body}</div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
