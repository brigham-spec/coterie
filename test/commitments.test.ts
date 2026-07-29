import { describe, expect, test } from "vitest";

import {
  filterCommitments,
  groupByOwner,
  ownerFacets,
  shapeCommitments,
  splitBySide,
  type Commitment,
  type RawCommitment,
} from "@/lib/commitments";

// Pure-logic tests for the commitments workspace shaping: side classification,
// urgency bucketing, most-overdue-first ordering, the search/urgency/owner
// filters, and the owner facets + board grouping.

// Fixed "now" = 2026-07-09. Both `now` and the due dates are built on the UTC
// calendar so dueInDays = (dueDay - 9) is deterministic in EVERY timezone —
// including positive-offset zones where a local-midnight `now` would roll back a
// UTC day and skew the delta (the off-by-one this suite guards against).
const now = new Date(Date.UTC(2026, 6, 9));
const dueOn = (day: number) => new Date(Date.UTC(2026, 6, day));

function staffItem(over: Partial<RawCommitment> & { owner?: string }): RawCommitment {
  return {
    id: over.id ?? "s",
    text: over.text ?? "staff item",
    status: over.status ?? "open",
    dueDate: over.dueDate ?? null,
    ownerUser: { id: over.owner ?? "u1", name: `Staffer ${over.owner ?? "u1"}` },
    ownerContact: null,
    meeting: over.meeting ?? null,
  };
}

function contactItem(over: Partial<RawCommitment>): RawCommitment {
  return {
    id: over.id ?? "c",
    text: over.text ?? "contact item",
    status: over.status ?? "open",
    dueDate: over.dueDate ?? null,
    ownerUser: null,
    ownerContact: {
      id: over.id ?? "c",
      name: "Guest",
      company: { id: "acme", name: "Acme" },
    },
    meeting: over.meeting ?? null,
  };
}

function shapeOpen(rows: RawCommitment[]): Commitment[] {
  return shapeCommitments(rows, now).filter((c) => c.status === "open");
}

describe("shapeCommitments", () => {
  test("classifies side, computes signed dueInDays, and buckets urgency", () => {
    const items = shapeCommitments(
      [
        staffItem({ id: "past", dueDate: dueOn(1) }),
        contactItem({ id: "today", dueDate: dueOn(9) }),
        contactItem({ id: "soon", dueDate: dueOn(15) }),
        contactItem({ id: "later", dueDate: dueOn(30) }),
        contactItem({ id: "none", dueDate: null }),
      ],
      now,
    );
    const byId = Object.fromEntries(items.map((c) => [c.id, c]));
    expect(byId.past.side).toBe("we_owe");
    expect(byId.past.dueInDays).toBe(-8);
    expect(byId.past.urgency).toBe("overdue");
    expect(byId.today.urgency).toBe("soon");
    expect(byId.today.dueInDays).toBe(0);
    expect(byId.soon.urgency).toBe("soon");
    expect(byId.later.urgency).toBe("later");
    expect(byId.none.urgency).toBe("none");
    expect(byId.none.dueInDays).toBeNull();
  });

  test("carries the staff owner id for we-owe, null for they-owe", () => {
    const items = shapeCommitments(
      [staffItem({ id: "s", owner: "u9" }), contactItem({ id: "c" })],
      now,
    );
    const byId = Object.fromEntries(items.map((c) => [c.id, c]));
    expect(byId.s.ownerId).toBe("u9");
    expect(byId.c.ownerId).toBeNull();
    expect(byId.c.companyName).toBe("Acme");
    // They-owe carries the contact/company ids (the cross-link targets); we-owe null.
    expect(byId.c.contactId).toBe("c");
    expect(byId.c.companyId).toBe("acme");
    expect(byId.s.contactId).toBeNull();
    expect(byId.s.companyId).toBeNull();
  });

  test("normalizes an out-of-vocab status to open and skips owner-less rows", () => {
    const items = shapeCommitments(
      [
        staffItem({ id: "weird", status: "bogus" }),
        {
          id: "x",
          text: "orphan",
          status: "open",
          dueDate: null,
          ownerUser: null,
          ownerContact: null,
          meeting: null,
        },
      ],
      now,
    );
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("weird");
    expect(items[0].status).toBe("open");
  });

  test("preserves the in-vocab waiting status", () => {
    const items = shapeCommitments([staffItem({ id: "w", status: "waiting" })], now);
    expect(items[0].status).toBe("waiting");
  });
});

describe("splitBySide", () => {
  test("splits into we-owe / they-owe, most-overdue first, undated last", () => {
    const items = shapeOpen([
      contactItem({ id: "upcoming", dueDate: dueOn(20) }),
      contactItem({ id: "undated", dueDate: null }),
      contactItem({ id: "overdue", dueDate: dueOn(1) }),
      staffItem({ id: "mine", dueDate: dueOn(5) }),
    ]);
    const { weOwe, theyOwe } = splitBySide(items);
    expect(weOwe.map((c) => c.id)).toEqual(["mine"]);
    expect(theyOwe.map((c) => c.id)).toEqual(["overdue", "upcoming", "undated"]);
  });
});

describe("filterCommitments", () => {
  const items = shapeOpen([
    staffItem({ id: "a", text: "Send the grant packet", owner: "u1", dueDate: dueOn(1) }),
    staffItem({ id: "b", text: "Draft the MOU", owner: "u2", dueDate: dueOn(12) }),
    contactItem({ id: "c", text: "Return the signed lease", dueDate: dueOn(2) }),
  ]);

  test("search matches text, owner, company, and meeting", () => {
    expect(
      filterCommitments(items, { q: "grant", urgency: "", owner: "" }).map((c) => c.id),
    ).toEqual(["a"]);
    expect(
      filterCommitments(items, { q: "acme", urgency: "", owner: "" }).map((c) => c.id),
    ).toEqual(["c"]);
  });

  test("urgency chip restricts to a bucket", () => {
    expect(
      filterCommitments(items, { q: "", urgency: "overdue", owner: "" })
        .map((c) => c.id)
        .sort(),
    ).toEqual(["a", "c"]);
    expect(
      filterCommitments(items, { q: "", urgency: "soon", owner: "" }).map((c) => c.id),
    ).toEqual(["b"]);
  });

  test("owner chip restricts to a staff owner and never matches they-owe", () => {
    expect(
      filterCommitments(items, { q: "", urgency: "", owner: "u2" }).map((c) => c.id),
    ).toEqual(["b"]);
    expect(
      filterCommitments(items, { q: "", urgency: "", owner: "u1" }).map((c) => c.id),
    ).toEqual(["a"]);
  });
});

describe("ownerFacets / groupByOwner", () => {
  const items = shapeOpen([
    staffItem({ id: "a", owner: "u2" }),
    staffItem({ id: "b", owner: "u1" }),
    staffItem({ id: "c", owner: "u1" }),
    contactItem({ id: "d" }),
  ]);

  test("ownerFacets lists distinct staff owners with counts, sorted by name", () => {
    const facets = ownerFacets(items);
    expect(facets.map((f) => f.id)).toEqual(["u1", "u2"]);
    expect(facets.find((f) => f.id === "u1")?.count).toBe(2);
  });

  test("groupByOwner buckets we-owe into per-owner columns", () => {
    const { weOwe } = splitBySide(items);
    const cols = groupByOwner(weOwe);
    expect(cols.map((c) => c.id)).toEqual(["u1", "u2"]);
    expect(cols[0].items.map((c) => c.id).sort()).toEqual(["b", "c"]);
  });
});
