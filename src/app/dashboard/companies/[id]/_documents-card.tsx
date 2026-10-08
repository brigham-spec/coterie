import { CollapsibleCard } from "@/components/collapsible-card";

import { deleteCompanyDocument } from "./actions";

// Persisted analyzed-document list. "Analyze a document" (_analyze-document.tsx)
// now saves the AI's one-line summary + file name here so the analysis stays
// visible after a refresh (the raw file bytes are a later Vercel-Blob follow-up).
// Server component — the only interaction is a per-row delete server action.

export type CompanyDocumentRow = {
  id: string;
  fileName: string;
  summary: string;
  createdAt: Date;
};

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function DocumentsCard({
  companyId,
  documents,
}: {
  companyId: string;
  documents: CompanyDocumentRow[];
}) {
  if (documents.length === 0) return null;

  return (
    <CollapsibleCard id="company-documents" title="Documents">
      <ul className="divide-y divide-line">
        {documents.map((d) => (
          <li key={d.id} className="flex flex-col gap-1 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="text-xs font-medium text-ink">{d.fileName}</span>
                <span className="ml-2 text-[10px] text-ink-3">
                  {dateFmt.format(d.createdAt)}
                </span>
              </div>
              <form action={deleteCompanyDocument} className="shrink-0">
                <input type="hidden" name="documentId" value={d.id} />
                <input type="hidden" name="companyId" value={companyId} />
                <button
                  type="submit"
                  className="text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
                >
                  Remove
                </button>
              </form>
            </div>
            {d.summary ? (
              <p className="text-[11.5px] leading-relaxed text-ink-2">{d.summary}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </CollapsibleCard>
  );
}
