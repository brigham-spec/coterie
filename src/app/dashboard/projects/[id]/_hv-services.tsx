"use client";

import { useState } from "react";

import { Button, Card, CardHeader, Field, SelectField } from "@/components/ui";
import {
  FEE_STATUSES,
  SERVICE_STATUSES,
  sumActiveServiceFees,
  type HvService,
} from "@/lib/hv-services";

import { updateHvServices } from "../actions";

// HVEDC Services card (projects-module parity; ported from the prototype's "HVEDC
// Services on this Project" section, Coterie.html:17707). Tracks what HVEDC is
// doing for a project across five service lines, each with a fee. Active fees flow
// into Revenue reporting. The whole five-line object is written at once by
// updateHvServices; this holds only local UI state (edit open).

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function HvServicesCard({
  projectId,
  services,
}: {
  projectId: string;
  services: HvService[];
}) {
  const [editing, setEditing] = useState(false);

  const active = services.filter((s) => s.line.active);
  const totalFees = sumActiveServiceFees(services);

  return (
    <Card>
      <CardHeader
        title="HVEDC services"
        action={
          <div className="flex items-center gap-3">
            {totalFees > 0 ? (
              <span className="text-[10px] font-medium text-teal-ink">
                {dollars.format(totalFees)} fees
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
            >
              {editing ? "Close" : "Edit"}
            </button>
          </div>
        }
      />

      <p className="border-b border-line px-4 py-2 text-[10.5px] text-ink-3">
        What HVEDC is doing for this project. Fees flow into Revenue reporting.
      </p>

      {editing ? (
        <form
          action={async (fd) => {
            await updateHvServices(fd);
            setEditing(false);
          }}
          className="flex flex-col gap-3 border-b border-line p-4"
        >
          <input type="hidden" name="projectId" value={projectId} />
          {services.map((s) => (
            <div
              key={s.key}
              className="rounded-md border border-line p-3"
            >
              <label className="flex items-center gap-2 text-xs font-medium text-ink">
                <input
                  type="checkbox"
                  name={`${s.key}_active`}
                  defaultChecked={s.line.active}
                  className="h-3.5 w-3.5"
                />
                {s.label}
              </label>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SelectField
                  name={`${s.key}_status`}
                  label="Status"
                  defaultValue={s.line.status}
                >
                  <option value="">—</option>
                  {SERVICE_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </SelectField>
                <Field
                  name={`${s.key}_description`}
                  label="Description"
                  defaultValue={s.line.description}
                  placeholder="Short note"
                />
                <Field
                  name={`${s.key}_fee`}
                  label="Fee ($)"
                  inputMode="numeric"
                  defaultValue={String(s.line.fee || "")}
                  placeholder="0"
                />
                <SelectField
                  name={`${s.key}_feeStatus`}
                  label="Fee status"
                  defaultValue={s.line.feeStatus}
                >
                  <option value="">—</option>
                  {FEE_STATUSES.map((fs) => (
                    <option key={fs} value={fs}>
                      {fs}
                    </option>
                  ))}
                </SelectField>
              </div>
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Save services
            </Button>
          </div>
        </form>
      ) : active.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          No HVEDC services tracked yet.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {active.map((s) => (
            <li
              key={s.key}
              className="flex items-start justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-ink">{s.label}</span>
                  {s.line.status ? (
                    <span className="rounded-full bg-teal-bg px-1.5 py-0.5 text-[9px] text-teal-ink">
                      {s.line.status}
                    </span>
                  ) : null}
                </div>
                {s.line.description ? (
                  <p className="mt-1 text-[10.5px] text-ink-3">{s.line.description}</p>
                ) : null}
              </div>
              {s.line.fee > 0 ? (
                <div className="shrink-0 text-right">
                  <div className="text-[11px] font-medium text-ink-2">
                    {dollars.format(s.line.fee)}
                  </div>
                  {s.line.feeStatus ? (
                    <div className="text-[9px] text-ink-3">{s.line.feeStatus}</div>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
