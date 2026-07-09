import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { GuestContext } from "@/lib/event-brief";

// Action-level integration test for events (slice 11.7). Exercises the event +
// guest-list actions against the real Neon DB — mocking only the external seams:
//   • generateBrief: mock Clerk + the guest-brief engine, assert the CONTEXT handed
//     to the engine is tenant-scoped and holds ONLY attending CRM guests (confirmed/
//     attended, with a profile) — never invited/declined, never external, never
//     another tenant's rows.
//   • createEvent / addInvitee / RSVP: NOT mocked — proves real persistence in the
//     caller's tenant, that a cross-org contact can't be smuggled onto a guest list,
//     and that the event is invisible to another tenant (RLS).

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/event-brief", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/event-brief")>();
  return { ...actual, generateGuestBriefs: genSpy };
});

const { createEvent, addInvitee, updateInviteeRsvp, removeInvitee, generateBrief } =
  await import("@/app/dashboard/events/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

let aliceId: string; // orgA CRM contact — will confirm (should be briefed)
let bobId: string; // orgA CRM contact — stays invited (should be skipped)
let bContactId: string; // orgB CRM contact — cross-org smuggle target

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });

  await withOrg(orgA.id, async (tx) => {
    const company = await tx.company.create({
      data: {
        orgId: orgA.id,
        name: "Member A",
        status: "member",
        industry: "Legal",
        annualValue: 1000,
        lookingFor: "a capital partner",
        canOffer: "land-use counsel",
        contacts: {
          create: [
            { orgId: orgA.id, name: "Alice A", title: "Partner", isPrimary: true },
            { orgId: orgA.id, name: "Bob A", title: "Associate" },
          ],
        },
      },
      include: { contacts: true },
    });
    aliceId = company.contacts.find((c) => c.name === "Alice A")!.id;
    bobId = company.contacts.find((c) => c.name === "Bob A")!.id;
  });

  bContactId = (
    await withOrg(orgB.id, (tx) =>
      tx.company.create({
        data: {
          orgId: orgB.id,
          name: "Member B",
          status: "member",
          industry: "Finance",
          annualValue: 1000,
          contacts: { create: { orgId: orgB.id, name: "Carol B", isPrimary: true } },
        },
        include: { contacts: true },
      }),
    )
  ).contacts[0].id;

  mockCtx.orgId = orgA.id;
  mockCtx.userName = "Host Person";
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  genSpy.mockReset();
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

async function findEventId(name: string): Promise<string> {
  const ev = await withOrg(orgA.id, (tx) =>
    tx.event.findFirst({ where: { name } }),
  );
  return ev!.id;
}

describe("event + guest-list actions", () => {
  test("creates an event, invites a CRM contact + an external guest", async () => {
    await createEvent(
      fd({ name: "Fall Dinner", type: "member_dinner", stage: "planning" }),
    );
    const eventId = await findEventId("Fall Dinner");

    await addInvitee(fd({ eventId, contactId: aliceId }));
    await addInvitee(fd({ eventId, contactId: bobId }));
    await addInvitee(fd({ eventId, externalName: "Ext Guest", externalOrg: "Outside Co" }));

    const invitees = await withOrg(orgA.id, (tx) =>
      tx.eventInvitee.findMany({ where: { eventId }, orderBy: { createdAt: "asc" } }),
    );
    expect(invitees).toHaveLength(3);
    expect(invitees.every((i) => i.rsvp === "invited")).toBe(true);
    const external = invitees.find((i) => i.contactId == null);
    expect(external?.externalName).toBe("Ext Guest");
    expect(external?.externalOrg).toBe("Outside Co");
  });

  test("refuses a contact from another tenant on the guest list", async () => {
    const eventId = await findEventId("Fall Dinner");
    // mockCtx is orgA; bContactId belongs to orgB → RLS-scoped findUnique is null.
    await expect(addInvitee(fd({ eventId, contactId: bContactId }))).rejects.toThrow();
  });

  test("hands the engine only attending CRM guests as scoped context", async () => {
    genSpy.mockResolvedValue([]);
    const eventId = await findEventId("Fall Dinner");

    // Alice confirms (should be briefed); Bob stays invited (skipped); the external
    // guest has no profile (skipped even if attending).
    const aliceInvitee = await withOrg(orgA.id, (tx) =>
      tx.eventInvitee.findFirst({ where: { eventId, contactId: aliceId } }),
    );
    await updateInviteeRsvp(fd({ eventId, inviteeId: aliceInvitee!.id, rsvp: "confirmed" }));

    const state = await generateBrief({ status: "idle" }, fd({ eventId }));
    expect(state).toEqual({ status: "ok", briefs: [] });

    expect(genSpy).toHaveBeenCalledTimes(1);
    const [event, host, guests] = genSpy.mock.calls[0] as [
      unknown,
      string,
      GuestContext[],
    ];
    expect(host).toBe("Host Person");
    const names = guests.map((g) => g.name);
    expect(names).toEqual(["Alice A"]);
    expect(guests[0].org).toBe("Member A");
    expect(guests[0].seeking).toBe("a capital partner");
    expect(guests[0].brings).toBe("land-use counsel");
    void event;
  });

  test("returns empty state when no attending CRM guest exists", async () => {
    await createEvent(fd({ name: "Empty Event", type: "panel" }));
    const eventId = await findEventId("Empty Event");
    const state = await generateBrief({ status: "idle" }, fd({ eventId }));
    expect(state).toEqual({ status: "empty" });
    expect(genSpy).not.toHaveBeenCalled();
  });

  test("removes a guest, scoped to the tenant", async () => {
    const eventId = await findEventId("Fall Dinner");
    const bobInvitee = await withOrg(orgA.id, (tx) =>
      tx.eventInvitee.findFirst({ where: { eventId, contactId: bobId } }),
    );
    await removeInvitee(fd({ eventId, inviteeId: bobInvitee!.id }));
    const remaining = await withOrg(orgA.id, (tx) =>
      tx.eventInvitee.findMany({ where: { eventId } }),
    );
    expect(remaining.map((i) => i.contactId)).not.toContain(bobId);
  });

  test("the persisted event is invisible to another tenant (RLS)", async () => {
    const seenByB = await withOrg(orgB.id, (tx) =>
      tx.event.findMany({ where: { name: "Fall Dinner" } }),
    );
    expect(seenByB).toEqual([]);
  });
});
