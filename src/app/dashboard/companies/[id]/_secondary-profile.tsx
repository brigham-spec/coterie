"use client";

import { useActionState, useState } from "react";

import { Button, Field, Textarea } from "@/components/ui";
import { CollapsibleCard } from "@/components/collapsible-card";

import {
  applySecondaryProfile,
  enrichSecondaryProfile,
  updateSecondaryProfile,
  type ApplySecondaryProfileState,
  type SecondaryProfileState,
} from "./actions";

// Secondary-profile section. A member's ADDITIONAL business lines / capabilities
// synthesized from its affiliations + uploaded documents, surfaced here and fed
// into the intro engine as supporting signal (weighted below the primary
// profile). Two surfaces: a plain hand-editable form (updateSecondaryProfile) and
// an "Incorporate from affiliations & documents" AI button that proposes values
// (enrichSecondaryProfile) for per-field review before anything is written
// (applySecondaryProfile). The proposal is ephemeral; the Anthropic key stays
// server-side.

const enrichInitial: SecondaryProfileState = { status: "idle" };
const applyInitial: ApplySecondaryProfileState = { status: "idle" };

const FIELDS = [
  { key: "secondaryIndustry", label: "Additional industries" },
  { key: "secondaryCanOffer", label: "Can also offer" },
  { key: "secondaryLookingFor", label: "Also looking for" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

export function SecondaryProfileCard({
  companyId,
  secondaryIndustry,
  secondaryCanOffer,
  secondaryLookingFor,
}: {
  companyId: string;
  secondaryIndustry: string;
  secondaryCanOffer: string;
  secondaryLookingFor: string;
}) {
  const [enrichState, enrichAction, enriching] = useActionState(
    enrichSecondaryProfile,
    enrichInitial,
  );
  const [applyState, applyAction, applying] = useActionState(
    applySecondaryProfile,
    applyInitial,
  );
  const [dropped, setDropped] = useState<Partial<Record<FieldKey, boolean>>>({});

  const review =
    enrichState.status === "ok" && applyState.status !== "applied"
      ? enrichState.proposal
      : null;

  const selection = review
    ? FIELDS.reduce<Record<string, string>>((acc, f) => {
        const value = review[f.key];
        if (value && !dropped[f.key]) acc[f.key] = value;
        return acc;
      }, {})
    : {};
  const selectedCount = Object.keys(selection).length;

  return (
    <CollapsibleCard
      id="company-secondary-profile"
      title="Secondary profile"
      action={
        <form action={enrichAction}>
          <input type="hidden" name="companyId" value={companyId} />
          <Button type="submit" variant="gold" disabled={enriching}>
            {enriching
              ? "Synthesizing…"
              : enrichState.status === "ok"
                ? "Re-run"
                : "Incorporate from affiliations & documents"}
          </Button>
        </form>
      }
    >
      <div className="px-4 py-4">
        <p className="mb-3 text-[11px] text-ink-3">
          Additional business lines and capabilities beyond this member&apos;s
          primary profile — drawn from their affiliations and documents. The intro
          engine uses this as supporting signal, weighted below the primary
          profile.
        </p>

        {enrichState.status === "error" ? (
          <p className="mb-3 text-xs text-red-ink">{enrichState.message}</p>
        ) : applyState.status === "applied" ? (
          <p className="mb-3 text-xs text-ink-2">
            Applied {applyState.count} field{applyState.count === 1 ? "" : "s"} to
            the secondary profile.
          </p>
        ) : null}

        {review ? (
          <form action={applyAction} className="mb-4">
            <input type="hidden" name="companyId" value={companyId} />
            <input
              type="hidden"
              name="proposal"
              value={JSON.stringify(selection)}
            />

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
                {applying ? "Applying…" : `Apply ${selectedCount} selected`}
              </Button>
            </div>
          </form>
        ) : null}

        <form action={updateSecondaryProfile} className="flex flex-col gap-4">
          <input type="hidden" name="companyId" value={companyId} />
          <Field
            name="secondaryIndustry"
            label="Additional industries"
            defaultValue={secondaryIndustry}
          />
          <Textarea
            name="secondaryCanOffer"
            label="Can also offer"
            defaultValue={secondaryCanOffer}
          />
          <Textarea
            name="secondaryLookingFor"
            label="Also looking for"
            defaultValue={secondaryLookingFor}
          />
          <div className="flex justify-end">
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      </div>
    </CollapsibleCard>
  );
}
