"use client";

import { useActionState, useState } from "react";

import { Button, Card, CardHeader, Field, Textarea } from "@/components/ui";

import {
  synthesizePartner,
  updatePartnership,
  type PartnerSynthState,
} from "./actions";

// Partnership card (profile-parity P6a). Only rendered for strategic_partner
// companies. Edits the partnership block — category, relationship/role, a
// who-they-are/why-strategic summary, and active collaboration — and offers an
// AI "Synthesize" that web-researches the partner and drafts the category,
// summary, and collaboration for the operator to fold in. All writes run through
// the withOrg-scoped actions; the Anthropic key never reaches the browser. The
// form fields are controlled so a synthesized draft can populate them in place
// before the operator saves.

export type Partnership = {
  website: string;
  partnerCategory: string;
  partnerRelationship: string;
  partnerSummary: string;
  collaborationNotes: string;
};

const synthInitial: PartnerSynthState = { status: "idle" };

export function PartnershipCard({
  companyId,
  partnership,
}: {
  companyId: string;
  partnership: Partnership;
}) {
  const [website, setWebsite] = useState(partnership.website);
  const [category, setCategory] = useState(partnership.partnerCategory);
  const [relationship, setRelationship] = useState(
    partnership.partnerRelationship,
  );
  const [summary, setSummary] = useState(partnership.partnerSummary);
  const [collaboration, setCollaboration] = useState(
    partnership.collaborationNotes,
  );

  const [synthState, synthAction, synthesizing] = useActionState(
    synthesizePartner,
    synthInitial,
  );

  const draft = synthState.status === "ok" ? synthState.synthesis : null;

  // Fold the draft's non-empty fields into the form, then let the operator save.
  function applyDraft() {
    if (draft == null) return;
    if (draft.category) setCategory(draft.category);
    if (draft.summary) setSummary(draft.summary);
    if (draft.collaboration) setCollaboration(draft.collaboration);
  }

  return (
    <Card>
      <CardHeader
        title="Partnership"
        action={
          <form action={synthAction}>
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="website" value={website} />
            <input
              type="hidden"
              name="partnerRelationship"
              value={relationship}
            />
            <Button type="submit" variant="gold" disabled={synthesizing}>
              {synthesizing ? "Researching…" : "Synthesize"}
            </Button>
          </form>
        }
      />

      <div className="p-4">
        {synthState.status === "error" ? (
          <p className="mb-3 text-xs text-red-600">{synthState.message}</p>
        ) : null}

        {draft ? (
          <div className="mb-4 rounded border border-gold/40 bg-surface-2 p-3">
            <div className="mb-2 text-[9px] font-medium tracking-[0.08em] text-ink-3 uppercase">
              Synthesized draft
            </div>
            {draft.category ? (
              <p className="text-xs text-ink-2">
                <span className="text-ink-3">Category:</span> {draft.category}
              </p>
            ) : null}
            {draft.summary ? (
              <p className="mt-1 text-xs whitespace-pre-wrap text-ink-2">
                {draft.summary}
              </p>
            ) : null}
            {draft.collaboration ? (
              <p className="mt-1 text-xs text-ink-2">
                <span className="text-ink-3">Collaboration:</span>{" "}
                {draft.collaboration}
              </p>
            ) : null}
            <div className="mt-2 flex justify-end">
              <Button type="button" variant="primary" onClick={applyDraft}>
                Use this draft
              </Button>
            </div>
          </div>
        ) : null}

        <form action={updatePartnership} className="flex flex-col gap-4">
          <input type="hidden" name="companyId" value={companyId} />

          <div className="grid grid-cols-2 gap-4">
            <Field
              name="website"
              label="Website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
            <Field
              name="partnerCategory"
              label="Partner category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>

          <Textarea
            name="partnerRelationship"
            label="Relationship / role"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
          />
          <Textarea
            name="partnerSummary"
            label="Partnership summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
          <Textarea
            name="collaborationNotes"
            label="Active collaboration"
            value={collaboration}
            onChange={(e) => setCollaboration(e.target.value)}
          />

          <div className="flex justify-end">
            <Button type="submit" variant="primary">
              Save partnership
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}
