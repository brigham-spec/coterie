"use client";

import { useActionState, useState } from "react";

import { Button, Card, CardHeader } from "@/components/ui";

import {
  applyMeetingEnrichment,
  enrichFromMeetingsAction,
  type ApplyEnrichmentState,
  type EnrichMeetingsState,
} from "./actions";

// Client shell for enrich-from-meetings (gap-audit cluster E). Two steps, two
// server actions: "Enrich from meetings" (the AI seam) reads this member's recent
// synced meetings and proposes profile fields → the operator reviews a checklist
// and applies only what they check. The proposal is ephemeral; nothing is written
// until Apply. The Anthropic key never crosses to the browser — both actions run
// server-side.

const enrichInitial: EnrichMeetingsState = { status: "idle" };
const applyInitial: ApplyEnrichmentState = { status: "idle" };

// The four writable fields, in review order. `industry` is only offered when the
// model returned a genuinely new sector (the engine clears an echo of the current).
const FIELDS = [
  { key: "lookingFor", label: "Looking for" },
  { key: "canOffer", label: "Can offer" },
  { key: "industry", label: "Industry" },
  { key: "notesAppend", label: "Append to notes" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

export function EnrichFromMeetings({ companyId }: { companyId: string }) {
  const [enrichState, enrichAction, enriching] = useActionState(
    enrichFromMeetingsAction,
    enrichInitial,
  );
  const [applyState, applyAction, applying] = useActionState(
    applyMeetingEnrichment,
    applyInitial,
  );
  const [dropped, setDropped] = useState<Partial<Record<FieldKey, boolean>>>({});

  const review =
    enrichState.status === "ok" && applyState.status !== "applied"
      ? enrichState.enrichment
      : null;

  // Only the checked (non-dropped) non-empty fields are posted to the apply action.
  const selection = review
    ? FIELDS.reduce<Record<string, string>>((acc, f) => {
        const value = review[f.key];
        if (value && !dropped[f.key]) acc[f.key] = value;
        return acc;
      }, {})
    : {};
  const selectedCount = Object.keys(selection).length;

  return (
    <Card>
      <CardHeader
        title="Enrich from meetings"
        action={
          <form action={enrichAction}>
            <input type="hidden" name="companyId" value={companyId} />
            <Button type="submit" variant="gold" disabled={enriching}>
              {enriching
                ? "Reading…"
                : enrichState.status === "ok"
                  ? "Re-scan"
                  : "Enrich from meetings"}
            </Button>
          </form>
        }
      />

      <div className="px-4 py-4">
        {enrichState.status === "error" ? (
          <p className="text-xs text-red-600">{enrichState.message}</p>
        ) : applyState.status === "applied" ? (
          <p className="text-xs text-ink-2">
            Applied {applyState.count} field{applyState.count === 1 ? "" : "s"} to
            this profile.
          </p>
        ) : review ? null : (
          <p className="text-xs text-ink-3">
            Pull what this member is looking for, what they can offer, and their
            sector out of recent meeting notes — review before anything is saved.
          </p>
        )}

        {review ? (
          <form action={applyAction}>
            <input type="hidden" name="companyId" value={companyId} />
            <input
              type="hidden"
              name="enrichment"
              value={JSON.stringify(selection)}
            />

            {review.summary ? (
              <p className="mb-3 text-[11.5px] leading-relaxed text-ink-2 italic">
                {review.summary}
              </p>
            ) : null}

            <div className="space-y-2">
              {FIELDS.map((f) => {
                const value = review[f.key];
                if (!value) return null;
                const checked = !dropped[f.key];
                return (
                  <label
                    key={f.key}
                    className="flex cursor-pointer gap-2 text-[11.5px] leading-relaxed text-ink-2"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setDropped((d) => ({ ...d, [f.key]: checked }))
                      }
                      className="mt-0.5 shrink-0"
                    />
                    <span>
                      <span className="text-[9px] font-medium tracking-[0.08em] text-ink-3 uppercase">
                        {f.label}
                      </span>
                      <br />
                      {value}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="mt-3 flex justify-end">
              <Button
                type="submit"
                variant="primary"
                disabled={applying || selectedCount === 0}
              >
                {applying
                  ? "Applying…"
                  : `Apply ${selectedCount} selected`}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </Card>
  );
}
