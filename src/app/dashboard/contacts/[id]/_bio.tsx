"use client";

import { useActionState, useState } from "react";

import { Button, Card, CardHeader, Textarea } from "@/components/ui";

import {
  applyContactBio,
  generateContactBioAction,
  type ContactBioState,
} from "../actions";

// Bio card for the standalone contact page, sibling to the company enrich-from-web
// flow. Two steps: "Generate from LinkedIn" (the AI seam) researches this person
// with Claude's web_search tool — anchored on their saved LinkedIn URL — and
// proposes a bio; the operator reviews (and can edit) it, then Saves. The proposal
// is ephemeral; nothing is written until Save. The Anthropic key never crosses to
// the browser — both actions run server-side.

const genInitial: ContactBioState = { status: "idle" };

export function ContactBio({
  contactId,
  linkedin,
  bio,
}: {
  contactId: string;
  linkedin: string | null;
  bio: string;
}) {
  const [genState, genAction, generating] = useActionState(
    generateContactBioAction,
    genInitial,
  );
  // The generation result the operator has dismissed (saved or discarded). We
  // derive the review draft from the generation state rather than mirroring it
  // into separate state, and key dismissal on the state's IDENTITY (not its text)
  // so a regeneration that returns a byte-identical bio still re-surfaces for review.
  const [dismissed, setDismissed] = useState<ContactBioState | null>(null);
  const draft =
    genState.status === "ok" && genState !== dismissed ? genState.bio : null;

  return (
    <Card>
      <CardHeader
        title="Bio"
        action={
          <form action={genAction}>
            <input type="hidden" name="contactId" value={contactId} />
            <Button type="submit" variant="gold" disabled={generating}>
              {generating
                ? "Searching…"
                : bio || draft !== null
                  ? "Regenerate"
                  : "Generate from LinkedIn"}
            </Button>
          </form>
        }
      />
      <div className="px-4 py-4">
        {genState.status === "error" ? (
          <p className="mb-3 text-xs text-red-ink">{genState.message}</p>
        ) : null}

        {draft !== null ? (
          <form
            action={async (fd) => {
              await applyContactBio(fd);
              setDismissed(genState);
            }}
          >
            <input type="hidden" name="contactId" value={contactId} />
            <Textarea
              key={draft}
              name="bio"
              label="Proposed bio — edit before saving"
              defaultValue={draft}
              rows={5}
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" onClick={() => setDismissed(genState)}>
                Discard
              </Button>
              <Button type="submit" variant="primary">
                Save bio
              </Button>
            </div>
          </form>
        ) : bio ? (
          <p className="text-xs leading-relaxed whitespace-pre-wrap text-ink-2">
            {bio}
          </p>
        ) : (
          <p className="text-xs text-ink-3">
            {linkedin
              ? "Generate a professional bio from this contact's LinkedIn profile and the public web — review before it's saved."
              : "Add a LinkedIn URL in Details for the best result, or generate a bio from a web search by name — review before it's saved."}
          </p>
        )}
      </div>
    </Card>
  );
}
