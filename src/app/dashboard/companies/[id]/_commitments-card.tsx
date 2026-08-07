"use client";

import { useState } from "react";

import { Button, Card, CardHeader, Field, SelectField, Textarea } from "@/components/ui";
import { isActiveCommitment } from "@/lib/commitments";

import {
  addCommitment,
  updateCommitmentStatus,
  editCommitment,
  deleteCommitment,
  reassignCommitment,
  moveCommitment,
} from "./actions";

// Interactive commitments (profile-parity port of the prototype's per-member
// Action Items section). A commitment carries a direction: "we owe" (a staff
// owner) or "they owe" (a contact of this company). The owner-XOR is preserved
// server-side; this card only holds local UI state (which form is open, the
// direction chosen so the owner picker offers the right people). Every write
// goes through the withOrg-scoped commitment actions, which revalidate.

// Pin UTC: dueDate is a @db.Date (UTC-midnight); fixing the zone keeps server
// and client renders identical so React doesn't flag a hydration mismatch.
const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export type CommitmentRow = {
  id: string;
  text: string;
  status: string;
  dueDate: Date | null;
  ownerUserId: string | null;
  ownerName: string | null;
  projectName: string | null;
};

type Owner = { id: string; name: string };
type Project = { id: string; name: string };
type MoveTarget = { id: string; name: string };

export function CommitmentsCard({
  companyId,
  currentUserId,
  commitments,
  staff,
  contacts,
  projects,
  moveTargets,
}: {
  companyId: string;
  currentUserId: string;
  commitments: CommitmentRow[];
  staff: Owner[];
  contacts: Owner[];
  projects: Project[];
  // Other companies in this tenant a "we owe" item can be re-homed to.
  moveTargets: MoveTarget[];
}) {
  const [adding, setAdding] = useState(false);

  const open = commitments.filter((c) => isActiveCommitment(c.status));
  const weOwe = open.filter((c) => c.ownerUserId != null);
  const theyOwe = open.filter((c) => c.ownerUserId == null);
  const closed = commitments.filter((c) => !isActiveCommitment(c.status));

  return (
    <Card>
      <CardHeader
        title="Commitments"
        action={
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
          >
            {adding ? "Close" : "Add commitment"}
          </button>
        }
      />

      {adding ? (
        <div className="border-b border-line p-4">
          <CommitmentForm
            companyId={companyId}
            currentUserId={currentUserId}
            staff={staff}
            contacts={contacts}
            projects={projects}
            onDone={() => setAdding(false)}
          />
        </div>
      ) : null}

      {open.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          No open commitments with this company.
        </p>
      ) : (
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <CommitmentColumn
            heading="We owe"
            companyId={companyId}
            items={weOwe}
            staff={staff}
            contacts={contacts}
            moveTargets={moveTargets}
          />
          <CommitmentColumn
            heading="They owe"
            companyId={companyId}
            items={theyOwe}
            staff={staff}
            contacts={contacts}
            moveTargets={moveTargets}
          />
        </div>
      )}

      {closed.length > 0 ? (
        <div className="border-t border-line px-4 py-3">
          <div className="mb-2 text-[10px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
            Resolved
          </div>
          <ul className="flex flex-col gap-1.5">
            {closed.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 text-[11px] text-ink-3"
              >
                <span className={c.status === "done" ? "line-through" : ""}>
                  {c.text}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="uppercase">{c.status}</span>
                  <form action={updateCommitmentStatus}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="companyId" value={companyId} />
                    <input type="hidden" name="status" value="open" />
                    <button
                      type="submit"
                      className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
                    >
                      Reopen
                    </button>
                  </form>
                  <form action={deleteCommitment}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="companyId" value={companyId} />
                    <button
                      type="submit"
                      className="text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
                    >
                      Remove
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function CommitmentColumn({
  heading,
  companyId,
  items,
  staff,
  contacts,
  moveTargets,
}: {
  heading: string;
  companyId: string;
  items: CommitmentRow[];
  staff: Owner[];
  contacts: Owner[];
  moveTargets: MoveTarget[];
}) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
        {heading}
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-ink-3 italic">Nothing outstanding.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((c) => (
            <CommitmentItem
              key={c.id}
              companyId={companyId}
              item={c}
              staff={staff}
              contacts={contacts}
              moveTargets={moveTargets}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CommitmentItem({
  companyId,
  item,
  staff,
  contacts,
  moveTargets,
}: {
  companyId: string;
  item: CommitmentRow;
  staff: Owner[];
  contacts: Owner[];
  moveTargets: MoveTarget[];
}) {
  const [editing, setEditing] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [moving, setMoving] = useState(false);
  // Only a "we owe" (staff-owned) item can move to another company; a they-owe
  // item is owed by a contact of this company, so it stays put (reassign first).
  const canMove = item.ownerUserId != null && moveTargets.length > 0;

  if (editing) {
    return (
      <li>
        <form
          action={async (fd) => {
            await editCommitment(fd);
            setEditing(false);
          }}
          className="flex flex-col gap-2"
        >
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="companyId" value={companyId} />
          <Textarea name="text" label="Commitment" defaultValue={item.text} required />
          <Field
            name="dueDate"
            label="Due date"
            type="date"
            defaultValue={
              item.dueDate ? item.dueDate.toISOString().slice(0, 10) : ""
            }
          />
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      </li>
    );
  }

  const waiting = item.status === "waiting";

  return (
    <li className={`text-xs text-ink-2${waiting ? " border-l-2 border-gold-line pl-2" : ""}`}>
      <div>{item.text}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-ink-3">
        {waiting ? (
          <span className="font-semibold tracking-[0.06em] text-gold uppercase">
            Waiting
          </span>
        ) : null}
        {item.ownerName ? <span>{item.ownerName}</span> : null}
        {item.projectName ? <span>· {item.projectName}</span> : null}
        {item.dueDate ? <span>· due {dateFmt.format(item.dueDate)}</span> : null}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <form action={updateCommitmentStatus}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="status" value="done" />
          <button
            type="submit"
            className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
          >
            Done
          </button>
        </form>
        <form action={updateCommitmentStatus}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="status" value={waiting ? "open" : "waiting"} />
          <button
            type="submit"
            className="text-[10px] font-medium tracking-[0.06em] text-ink-3 uppercase hover:underline"
          >
            {waiting ? "Resume" : "Waiting"}
          </button>
        </form>
        <form action={updateCommitmentStatus}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="status" value="dropped" />
          <button
            type="submit"
            className="text-[10px] font-medium tracking-[0.06em] text-ink-3 uppercase hover:underline"
          >
            Drop
          </button>
        </form>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[10px] font-medium tracking-[0.06em] text-ink-3 uppercase hover:underline"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setReassigning((v) => !v)}
          className="text-[10px] font-medium tracking-[0.06em] text-ink-3 uppercase hover:underline"
        >
          Reassign
        </button>
        {canMove ? (
          <button
            type="button"
            onClick={() => setMoving((v) => !v)}
            className="text-[10px] font-medium tracking-[0.06em] text-ink-3 uppercase hover:underline"
          >
            Move
          </button>
        ) : null}
        <form action={deleteCommitment}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="companyId" value={companyId} />
          <button
            type="submit"
            className="text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
          >
            Remove
          </button>
        </form>
      </div>
      {reassigning ? (
        <ReassignForm
          companyId={companyId}
          item={item}
          staff={staff}
          contacts={contacts}
          onDone={() => setReassigning(false)}
        />
      ) : null}
      {moving ? (
        <MoveForm
          companyId={companyId}
          item={item}
          moveTargets={moveTargets}
          onDone={() => setMoving(false)}
        />
      ) : null}
    </li>
  );
}

// Inline "move to another company" picker for a we-owe item — re-homes it to
// the chosen company (staff owner rides along). The list is this tenant's other
// companies (moveTargets); the server re-validates the destination is in-org.
function MoveForm({
  companyId,
  item,
  moveTargets,
  onDone,
}: {
  companyId: string;
  item: CommitmentRow;
  moveTargets: MoveTarget[];
  onDone: () => void;
}) {
  const [targetCompanyId, setTargetCompanyId] = useState("");

  return (
    <form
      action={async (fd) => {
        await moveCommitment(fd);
        onDone();
      }}
      className="mt-1.5 flex flex-wrap items-center gap-1.5"
    >
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="companyId" value={companyId} />
      <select
        name="targetCompanyId"
        value={targetCompanyId}
        onChange={(e) => setTargetCompanyId(e.target.value)}
        required
        className="rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink-2"
      >
        <option value="" disabled>
          Move to…
        </option>
        {moveTargets.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={targetCompanyId === ""}
        className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline disabled:opacity-40"
      >
        Move
      </button>
      <button
        type="button"
        onClick={onDone}
        className="text-[10px] font-medium tracking-[0.06em] text-ink-3 uppercase hover:underline"
      >
        Cancel
      </button>
    </form>
  );
}

// Inline owner picker: staff (→ we owe) or one of this company's contacts (→ they
// owe). The option value carries both the direction and the id ("we_owe:<id>" /
// "they_owe:<id>"); the submit derives the two fields reassignCommitment reads.
function ReassignForm({
  companyId,
  item,
  staff,
  contacts,
  onDone,
}: {
  companyId: string;
  item: CommitmentRow;
  staff: Owner[];
  contacts: Owner[];
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const sep = value.indexOf(":");
  const direction = sep >= 0 ? value.slice(0, sep) : "";
  const ownerId = sep >= 0 ? value.slice(sep + 1) : "";

  return (
    <form
      action={async (fd) => {
        await reassignCommitment(fd);
        onDone();
      }}
      className="mt-1.5 flex flex-wrap items-center gap-1.5"
    >
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="ownerId" value={ownerId} />
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required
        className="rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink-2"
      >
        <option value="" disabled>
          Reassign to…
        </option>
        {staff.length > 0 ? (
          <optgroup label="We owe (staff)">
            {staff.map((s) => (
              <option key={s.id} value={`we_owe:${s.id}`}>
                {s.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {contacts.length > 0 ? (
          <optgroup label="They owe (contacts)">
            {contacts.map((c) => (
              <option key={c.id} value={`they_owe:${c.id}`}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      <button
        type="submit"
        disabled={value === ""}
        className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline disabled:opacity-40"
      >
        Reassign
      </button>
      <button
        type="button"
        onClick={onDone}
        className="text-[10px] font-medium tracking-[0.06em] text-ink-3 uppercase hover:underline"
      >
        Cancel
      </button>
    </form>
  );
}

function CommitmentForm({
  companyId,
  currentUserId,
  staff,
  contacts,
  projects,
  onDone,
}: {
  companyId: string;
  currentUserId: string;
  staff: Owner[];
  contacts: Owner[];
  projects: Project[];
  onDone: () => void;
}) {
  // Track direction so the owner picker offers the right people: staff for a
  // "we owe" item, this company's contacts for a "they owe" item.
  const [direction, setDirection] = useState<"we_owe" | "they_owe">("we_owe");
  const owners = direction === "we_owe" ? staff : contacts;
  const ownerDefault = direction === "we_owe" ? currentUserId : "";

  return (
    <form
      action={async (fd) => {
        await addCommitment(fd);
        onDone();
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="companyId" value={companyId} />

      <Textarea name="text" label="Commitment" required />

      <div className="grid grid-cols-2 gap-4">
        <SelectField
          name="direction"
          label="Direction"
          value={direction}
          onChange={(e) =>
            setDirection(e.currentTarget.value as "we_owe" | "they_owe")
          }
        >
          <option value="we_owe">We owe them</option>
          <option value="they_owe">They owe us</option>
        </SelectField>
        <SelectField
          name="ownerId"
          label="Owner"
          // Remount on direction change so the default selection resets.
          key={direction}
          defaultValue={ownerDefault}
          required
        >
          {direction === "they_owe" ? <option value="">Select…</option> : null}
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </SelectField>
        <Field name="dueDate" label="Due date" type="date" />
        <SelectField name="projectId" label="Project (optional)" defaultValue="">
          <option value="">None</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          Add commitment
        </Button>
      </div>
    </form>
  );
}
