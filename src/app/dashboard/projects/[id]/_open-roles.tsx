"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Card, CardHeader } from "@/components/ui";

import { scanOpenRole, type OpenRoleScanState } from "../actions";
import type { Discipline } from "@/lib/disciplines";
import type { RoleCandidate } from "@/lib/open-roles-engine";

// Open-roles panel (slice 11.4c) on the project detail page. A client shell over
// the scanOpenRole server action, so the Anthropic key never crosses to the
// browser. Each unfilled discipline is a submit button in one form; the clicked
// button contributes its `role` value to the FormData. Results are ephemeral —
// re-scanned on demand; scanning a different role replaces the shortlist.

const initialState: OpenRoleScanState = { status: "idle" };

const FIT_LABEL: Record<number, string> = { 5: "Strong", 4: "Good", 3: "Possible" };

export function OpenRoles({
  projectId,
  roles,
}: {
  projectId: string;
  roles: Discipline[];
}) {
  const [state, formAction, isPending] = useActionState(
    scanOpenRole,
    initialState,
  );

  return (
    <Card>
      <CardHeader title="Open roles" />
      <div className="p-4">
        <p className="mb-3 text-[11px] text-ink-3">
          Pick an unfilled role and the network will surface the best-fit
          companies to staff it.
        </p>
        <form action={formAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          {roles.map((d) => (
            <button
              key={d.value}
              type="submit"
              name="role"
              value={d.value}
              disabled={isPending}
              className="rounded-full border border-line bg-surface-2 px-3 py-1 text-[11px] text-ink-2 transition-colors hover:border-gold-line hover:text-gold disabled:opacity-50"
            >
              {d.label}
            </button>
          ))}
        </form>

        {isPending ? (
          <p className="mt-3 text-[11px] text-ink-3 italic">
            Scanning the network…
          </p>
        ) : state.status === "error" ? (
          <p className="mt-3 text-[11px] text-red-600">{state.message}</p>
        ) : state.status === "ok" ? (
          <div className="mt-4">
            <div className="mb-2 text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
              Best fits — {state.roleLabel}
            </div>
            {state.candidates.length === 0 ? (
              <p className="text-[11px] text-ink-3 italic">
                No suitable candidates surfaced for this role right now.
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {state.candidates.map((c) => (
                  <CandidateCard key={c.companyId} c={c} />
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function CandidateCard({ c }: { c: RoleCandidate }) {
  return (
    <li className="rounded-md border border-line bg-surface-2 px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/dashboard/companies/${c.companyId}`}
          className="min-w-0 text-[11.5px] font-semibold text-ink hover:underline"
        >
          {c.companyName}
        </Link>
        <span className="shrink-0 rounded-full border border-gold-line bg-gold-bg px-2 py-0.5 text-[10px] font-medium text-gold">
          {FIT_LABEL[c.score] ?? `${c.score}/5`}
        </span>
      </div>
      {c.whyFit ? (
        <p className="mt-1.5 text-[11px] text-ink-2">{c.whyFit}</p>
      ) : null}
      {c.concern ? (
        <p className="mt-1 text-[10.5px] text-ink-3 italic">
          Concern: {c.concern}
        </p>
      ) : null}
    </li>
  );
}
