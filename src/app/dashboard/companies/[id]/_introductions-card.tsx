"use client";

import { useState } from "react";
import Link from "next/link";

import {
  Button,
  Card,
  CardHeader,
  Field,
  SelectField,
  StatusBadge,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
} from "@/components/ui";
import { INTRO_STAGES, getIntroStageDef } from "@/lib/intro-stages";

import { confirmIntroAdvance } from "./actions";
import {
  createIntroduction,
  updateIntroduction,
  deleteIntroduction,
} from "../../introductions/actions";

// Relationship Introductions (Members audit item 25) — the prototype's inline
// intro management on the member modal, now on the company profile. Three
// surfaces in one card: (1) Fireflies-detected stage advances awaiting a
// human confirm, (2) an inline "Log intro" form (createIntroduction, source=
// manual), and (3) the ledger of this company's intros with per-row stage-
// advance / outcome / delete. Every write carries the companyId so the action
// revalidates THIS profile too. All mutating actions are withOrg-scoped and
// re-verify ownership server-side; this holds only local UI state.

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export type IntroRowData = {
  id: string;
  status: string;
  outcome: string | null;
  partyAName: string;
  partyACompanyName: string;
  partyBName: string;
  partyBCompanyName: string;
};

export type PendingIntro = {
  introId: string;
  partyALabel: string;
  partyBLabel: string;
  suggestedStage: string;
  meetingTitle: string;
  meetingDate: Date;
};

export type ContactOption = { id: string; name: string };
export type NetworkContactOption = { id: string; name: string; company: string };

export function IntroductionsCard({
  companyId,
  intros,
  pendingIntros,
  partyAOptions,
  partyBOptions,
}: {
  companyId: string;
  intros: IntroRowData[];
  pendingIntros: PendingIntro[];
  partyAOptions: ContactOption[];
  partyBOptions: NetworkContactOption[];
}) {
  const [logging, setLogging] = useState(false);
  // Logging needs one of this company's contacts as a party plus someone in the
  // network to connect them to.
  const canLog = partyAOptions.length > 0 && partyBOptions.length > 0;

  return (
    <Card>
      <CardHeader
        title="Introductions"
        action={
          <div className="flex items-center gap-4">
            {pendingIntros.length > 0 ? (
              <span className="rounded-full bg-teal-bg px-2 py-0.5 text-[10px] font-semibold text-teal-ink">
                {pendingIntros.length} pending
              </span>
            ) : null}
            {canLog ? (
              <button
                type="button"
                onClick={() => setLogging((v) => !v)}
                className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
              >
                {logging ? "Close" : "Log intro"}
              </button>
            ) : null}
          </div>
        }
      />

      {pendingIntros.length > 0 ? (
        <div className="border-b border-line bg-teal-bg/30 px-4 py-3">
          <div className="mb-2 text-[10px] font-semibold tracking-[0.06em] text-teal-ink uppercase">
            Detected from meetings
          </div>
          <div className="flex flex-col gap-2">
            {pendingIntros.map((d) => (
              <form
                key={d.introId}
                action={confirmIntroAdvance}
                className="flex flex-wrap items-center gap-2"
              >
                <input type="hidden" name="introId" value={d.introId} />
                <input type="hidden" name="status" value={d.suggestedStage} />
                <input type="hidden" name="companyId" value={companyId} />
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] font-medium text-ink">
                    {d.partyALabel} <span className="text-ink-3">&#8596;</span>{" "}
                    {d.partyBLabel}
                    <span className="ml-1.5 text-[10px] text-teal-ink">
                      &#8594; {getIntroStageDef(d.suggestedStage).label}
                    </span>
                  </div>
                  <div className="text-[10px] text-ink-3">
                    Detected: {d.meetingTitle} &middot;{" "}
                    {dateFmt.format(d.meetingDate)}
                  </div>
                </div>
                <Button type="submit">Confirm</Button>
              </form>
            ))}
          </div>
        </div>
      ) : null}

      {logging ? (
        <div className="border-b border-line p-4">
          <LogIntroForm
            companyId={companyId}
            partyAOptions={partyAOptions}
            partyBOptions={partyBOptions}
            onDone={() => setLogging(false)}
          />
        </div>
      ) : null}

      {intros.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          No introductions involving this company yet. Use “Log intro” to record
          one, or work the{" "}
          <Link href="/dashboard/introductions" className="text-gold underline">
            introductions
          </Link>{" "}
          page.
        </p>
      ) : (
        <Table
          head={
            <>
              <Th>Parties</Th>
              <Th>Stage</Th>
              <Th>Manage</Th>
            </>
          }
        >
          {intros.map((i) => (
            <IntroRow key={i.id} intro={i} companyId={companyId} />
          ))}
        </Table>
      )}
    </Card>
  );
}

function IntroRow({
  intro,
  companyId,
}: {
  intro: IntroRowData;
  companyId: string;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <Tr>
      <Td>
        <div className="font-medium text-ink">
          {intro.partyAName}
          <span className="text-ink-3"> · {intro.partyACompanyName}</span>
        </div>
        <div className="font-medium text-ink">
          {intro.partyBName}
          <span className="text-ink-3"> · {intro.partyBCompanyName}</span>
        </div>
        {intro.outcome ? (
          <div className="mt-1 text-[10px] text-ink-3 italic">
            {intro.outcome}
          </div>
        ) : null}
        {editing ? (
          <form
            action={async (fd) => {
              await updateIntroduction(fd);
              setEditing(false);
            }}
            className="mt-2 flex flex-col gap-2"
          >
            <input type="hidden" name="introId" value={intro.id} />
            <input type="hidden" name="companyId" value={companyId} />
            <SelectField
              name="status"
              label="Stage"
              defaultValue={intro.status}
            >
              {INTRO_STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </SelectField>
            <Textarea
              name="outcome"
              label="Outcome"
              defaultValue={intro.outcome ?? ""}
            />
            <div className="flex gap-2">
              <Button type="submit" variant="primary">
                Save
              </Button>
              <Button type="button" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </Td>
      <Td>
        <StatusBadge status={intro.status} />
      </Td>
      <Td className="text-right">
        {editing ? null : (
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase hover:text-gold"
            >
              Advance
            </button>
            <form action={deleteIntroduction}>
              <input type="hidden" name="introId" value={intro.id} />
              <input type="hidden" name="companyId" value={companyId} />
              <button
                type="submit"
                className="text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
              >
                Remove
              </button>
            </form>
          </div>
        )}
      </Td>
    </Tr>
  );
}

// Inline "Log intro" form. Party A/B are CONTROLLED so we can exclude the chosen
// A from B's options (createIntroduction throws on a self-pair — we prevent it
// client-side instead). Party A is one of this company's contacts; Party B is
// anyone in the network. connectionType is omitted (the action accepts ""), so
// this is the minimal manual-log shape.
function LogIntroForm({
  companyId,
  partyAOptions,
  partyBOptions,
  onDone,
}: {
  companyId: string;
  partyAOptions: ContactOption[];
  partyBOptions: NetworkContactOption[];
  onDone: () => void;
}) {
  const [partyA, setPartyA] = useState(partyAOptions[0]?.id ?? "");
  const [partyB, setPartyB] = useState("");
  const bOptions = partyBOptions.filter((c) => c.id !== partyA);

  return (
    <form
      action={async (fd) => {
        await createIntroduction(fd);
        onDone();
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="companyId" value={companyId} />

      <div className="grid grid-cols-2 gap-4">
        <SelectField
          name="partyAContactId"
          label="Party A"
          value={partyA}
          onChange={(e) => {
            const v = e.target.value;
            setPartyA(v);
            if (v === partyB) setPartyB("");
          }}
        >
          {partyAOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          name="partyBContactId"
          label="Party B"
          value={partyB}
          onChange={(e) => setPartyB(e.target.value)}
        >
          <option value="">Select…</option>
          {bOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.company}
            </option>
          ))}
        </SelectField>
        <SelectField name="status" label="Stage" defaultValue="made">
          {INTRO_STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </SelectField>
        <Field name="madeOn" label="Made on" type="date" />
        <Field name="headline" label="Headline" className="col-span-2" />
      </div>

      <Textarea name="notes" label="Notes" />

      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!partyB}>
          Log intro
        </Button>
      </div>
    </form>
  );
}
