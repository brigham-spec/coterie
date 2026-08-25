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

const outreachSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/event-outreach", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/event-outreach")>();
  return { ...actual, generateOutreachEmail: outreachSpy };
});

const {
  createEvent,
  addInvitee,
  updateInviteeRsvp,
  removeInvitee,
  setEventSponsor,
  generateBrief,
  draftOutreach,
  markOutreachSent,
  findEventTargets,
  updateEventDetails,
  updateEventCost,
  markAllAttended,
  addConversion,
  removeConversion,
} = await import("@/app/dashboard/events/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

let aliceId: string; // orgA CRM contact — will confirm (should be briefed)
let bobId: string; // orgA CRM contact — stays invited (should be skipped)
let bContactId: string; // orgB CRM contact — cross-org smuggle target
let companyAId: string; // orgA member company (conversion target)
let projectAId: string; // orgA project (event link target)
let projectBId: string; // orgB project — cross-org link smuggle target

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
    companyAId = company.id;
    const projectA = await tx.project.create({
      data: { orgId: orgA.id, name: "Mill Redevelopment", stage: "concept" },
    });
    projectAId = projectA.id;
  });

  const orgBData = await withOrg(orgB.id, async (tx) => {
    const company = await tx.company.create({
      data: {
        orgId: orgB.id,
        name: "Member B",
        status: "member",
        industry: "Finance",
        annualValue: 1000,
        contacts: { create: { orgId: orgB.id, name: "Carol B", isPrimary: true } },
      },
      include: { contacts: true },
    });
    const project = await tx.project.create({
      data: { orgId: orgB.id, name: "Foreign Project", stage: "concept" },
    });
    return { contactId: company.contacts[0].id, projectId: project.id };
  });
  bContactId = orgBData.contactId;
  projectBId = orgBData.projectId;

  mockCtx.orgId = orgA.id;
  mockCtx.userName = "Host Person";
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  genSpy.mockReset();
  outreachSpy.mockReset();
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

  test("drafts an invitation for a CRM guest with tenant-scoped context", async () => {
    outreachSpy.mockResolvedValue("Come see the mill, Alice.");
    const eventId = await findEventId("Fall Dinner");
    const aliceInvitee = await withOrg(orgA.id, (tx) =>
      tx.eventInvitee.findFirst({ where: { eventId, contactId: aliceId } }),
    );

    const state = await draftOutreach(
      { status: "idle" },
      fd({ eventId, inviteeId: aliceInvitee!.id }),
    );
    expect(state).toEqual({
      status: "ok",
      inviteeId: aliceInvitee!.id,
      guestName: "Alice A",
      draft: "Come see the mill, Alice.",
    });

    expect(outreachSpy).toHaveBeenCalledTimes(1);
    const [arg] = outreachSpy.mock.calls[0] as [
      {
        host: string;
        guest: { name: string; org: string | null; seeking: string | null; brings: string | null };
        event: { name: string };
        angle: string | null;
      },
    ];
    expect(arg.host).toBe("Host Person");
    expect(arg.event.name).toBe("Fall Dinner");
    expect(arg.guest.name).toBe("Alice A");
    expect(arg.guest.org).toBe("Member A");
    expect(arg.guest.seeking).toBe("a capital partner");
    expect(arg.guest.brings).toBe("land-use counsel");
    // First draft carries no refinement angle.
    expect(arg.angle).toBeNull();

    // The draft persisted on the invitee and moved it to the "draft" stage.
    const drafted = await withOrg(orgA.id, (tx) =>
      tx.eventInvitee.findUnique({ where: { id: aliceInvitee!.id } }),
    );
    expect(drafted!.outreachStatus).toBe("draft");
    expect(drafted!.outreachDraft).toBe("Come see the mill, Alice.");
  });

  test("redraft passes a validated angle; marking sent sticks and can be undone", async () => {
    outreachSpy.mockResolvedValue("A shorter note.");
    const eventId = await findEventId("Fall Dinner");
    const aliceInvitee = await withOrg(orgA.id, (tx) =>
      tx.eventInvitee.findFirst({ where: { eventId, contactId: aliceId } }),
    );

    // A junk angle is dropped; a known angle reaches the engine.
    await draftOutreach(
      { status: "idle" },
      fd({ eventId, inviteeId: aliceInvitee!.id, angle: "bogus" }),
    );
    expect((outreachSpy.mock.calls[0][0] as { angle: string | null }).angle).toBeNull();

    await draftOutreach(
      { status: "idle" },
      fd({ eventId, inviteeId: aliceInvitee!.id, angle: "shorter" }),
    );
    expect((outreachSpy.mock.calls[1][0] as { angle: string | null }).angle).toBe(
      "shorter",
    );

    // Mark sent persists the current (edited) draft, the sent stage, and a timestamp.
    await markOutreachSent(
      fd({ inviteeId: aliceInvitee!.id, sent: "true", draft: "My edited invite." }),
    );
    const sent = await withOrg(orgA.id, (tx) =>
      tx.eventInvitee.findUnique({ where: { id: aliceInvitee!.id } }),
    );
    expect(sent!.outreachStatus).toBe("sent");
    expect(sent!.outreachDraft).toBe("My edited invite.");
    expect(sent!.outreachSentAt).not.toBeNull();

    // A subsequent draft leaves an already-sent guest sent.
    outreachSpy.mockResolvedValue("Another pass.");
    await draftOutreach(
      { status: "idle" },
      fd({ eventId, inviteeId: aliceInvitee!.id }),
    );
    const afterDraft = await withOrg(orgA.id, (tx) =>
      tx.eventInvitee.findUnique({ where: { id: aliceInvitee!.id } }),
    );
    expect(afterDraft!.outreachStatus).toBe("sent");
    expect(afterDraft!.outreachDraft).toBe("Another pass.");

    // Undoing "sent" moves it back to draft and clears the timestamp.
    await markOutreachSent(
      fd({ inviteeId: aliceInvitee!.id, sent: "false", draft: "Another pass." }),
    );
    const undone = await withOrg(orgA.id, (tx) =>
      tx.eventInvitee.findUnique({ where: { id: aliceInvitee!.id } }),
    );
    expect(undone!.outreachStatus).toBe("draft");
    expect(undone!.outreachSentAt).toBeNull();
  });

  test("refuses to draft for an external guest (no profile)", async () => {
    const eventId = await findEventId("Fall Dinner");
    const external = await withOrg(orgA.id, (tx) =>
      tx.eventInvitee.findFirst({ where: { eventId, contactId: null } }),
    );
    const state = await draftOutreach(
      { status: "idle" },
      fd({ eventId, inviteeId: external!.id }),
    );
    expect(state.status).toBe("error");
    expect(outreachSpy).not.toHaveBeenCalled();
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

  test("persists external guest email + title", async () => {
    await createEvent(fd({ name: "Ext Event", type: "roundtable" }));
    const eventId = await findEventId("Ext Event");
    await addInvitee(
      fd({
        eventId,
        externalName: "Jamie Rivera",
        externalOrg: "Rivera Capital",
        externalEmail: "jamie@rivera.co",
        externalTitle: "Managing Partner",
      }),
    );
    const invitee = await withOrg(orgA.id, (tx) =>
      tx.eventInvitee.findFirst({ where: { eventId, externalName: "Jamie Rivera" } }),
    );
    expect(invitee?.externalEmail).toBe("jamie@rivera.co");
    expect(invitee?.externalTitle).toBe("Managing Partner");
  });

  test("edits details, links a project + venue, refusing foreign refs", async () => {
    await createEvent(
      fd({ name: "Linked Event", type: "site_visit", projectId: projectAId }),
    );
    const eventId = await findEventId("Linked Event");
    const linked = await withOrg(orgA.id, (tx) =>
      tx.event.findUnique({ where: { id: eventId }, select: { projectId: true } }),
    );
    expect(linked?.projectId).toBe(projectAId);

    // Edit core details plus the venue attribution (member company + the contact who
    // arranged it), both in-tenant.
    await updateEventDetails(
      fd({
        eventId,
        name: "Linked Event",
        type: "site_visit",
        stage: "confirmed",
        venueCompanyId: companyAId,
        venueContactId: aliceId,
      }),
    );
    const saved = await withOrg(orgA.id, (tx) =>
      tx.event.findUnique({
        where: { id: eventId },
        select: { stage: true, venueCompanyId: true, venueContactId: true },
      }),
    );
    expect(saved).toMatchObject({
      stage: "confirmed",
      venueCompanyId: companyAId,
      venueContactId: aliceId,
    });

    // orgB's project is invisible to orgA (RLS-scoped re-check) → refused.
    await expect(
      updateEventDetails(
        fd({ eventId, name: "Linked Event", type: "site_visit", projectId: projectBId }),
      ),
    ).rejects.toThrow();
    // A foreign venue contact is refused the same way.
    await expect(
      updateEventDetails(
        fd({ eventId, name: "Linked Event", type: "site_visit", venueContactId: bContactId }),
      ),
    ).rejects.toThrow();
    // An invalid stage is rejected before any write.
    await expect(
      updateEventDetails(
        fd({ eventId, name: "Linked Event", type: "site_visit", stage: "mystery" }),
      ),
    ).rejects.toThrow();

    // Clearing the project + venue links is allowed.
    await updateEventDetails(fd({ eventId, name: "Linked Event", type: "site_visit" }));
    const cleared = await withOrg(orgA.id, (tx) =>
      tx.event.findUnique({
        where: { id: eventId },
        select: { projectId: true, venueCompanyId: true, venueContactId: true },
      }),
    );
    expect(cleared).toEqual({
      projectId: null,
      venueCompanyId: null,
      venueContactId: null,
    });
  });

  test("designates a primary guest from the event's own guest list", async () => {
    await createEvent(fd({ name: "Sponsored Event", type: "member_dinner" }));
    const eventId = await findEventId("Sponsored Event");
    await addInvitee(fd({ eventId, contactId: aliceId }));
    const invitee = await withOrg(orgA.id, (tx) =>
      tx.eventInvitee.findFirst({ where: { eventId, contactId: aliceId } }),
    );

    // A guest on this event can be set as the primary guest.
    await setEventSponsor(fd({ eventId, inviteeId: invitee!.id }));
    const sponsored = await withOrg(orgA.id, (tx) =>
      tx.event.findUnique({ where: { id: eventId }, select: { sponsorInviteeId: true } }),
    );
    expect(sponsored?.sponsorInviteeId).toBe(invitee!.id);

    // A guest belonging to a DIFFERENT event is refused.
    await createEvent(fd({ name: "Other Event", type: "panel" }));
    const otherEventId = await findEventId("Other Event");
    await addInvitee(fd({ eventId: otherEventId, contactId: bobId }));
    const otherInvitee = await withOrg(orgA.id, (tx) =>
      tx.eventInvitee.findFirst({ where: { eventId: otherEventId, contactId: bobId } }),
    );
    await expect(
      setEventSponsor(fd({ eventId, inviteeId: otherInvitee!.id })),
    ).rejects.toThrow();
    // A bogus invitee id is refused.
    await expect(
      setEventSponsor(fd({ eventId, inviteeId: randomUUID() })),
    ).rejects.toThrow();

    // Clearing the primary guest is allowed.
    await setEventSponsor(fd({ eventId, inviteeId: "" }));
    const cleared = await withOrg(orgA.id, (tx) =>
      tx.event.findUnique({ where: { id: eventId }, select: { sponsorInviteeId: true } }),
    );
    expect(cleared?.sponsorInviteeId).toBeNull();
  });

  test("marks only confirmed guests as attended", async () => {
    await createEvent(fd({ name: "Attendance Event", type: "panel" }));
    const eventId = await findEventId("Attendance Event");
    await addInvitee(fd({ eventId, contactId: aliceId }));
    await addInvitee(fd({ eventId, externalName: "Declining Guest" }));

    const aliceInv = await withOrg(orgA.id, (tx) =>
      tx.eventInvitee.findFirst({ where: { eventId, contactId: aliceId } }),
    );
    await updateInviteeRsvp(
      fd({ eventId, inviteeId: aliceInv!.id, rsvp: "confirmed" }),
    );

    await markAllAttended(fd({ eventId }));

    const rows = await withOrg(orgA.id, (tx) =>
      tx.eventInvitee.findMany({ where: { eventId } }),
    );
    const alice = rows.find((r) => r.contactId === aliceId);
    const external = rows.find((r) => r.contactId == null);
    expect(alice?.rsvp).toBe("attended"); // was confirmed
    expect(external?.rsvp).toBe("invited"); // untouched (never confirmed)
  });

  test("logs a conversion snapshotting name + defaulting ARR to annualValue", async () => {
    await createEvent(fd({ name: "ROI Event", type: "member_dinner" }));
    const eventId = await findEventId("ROI Event");
    await updateEventCost(fd({ eventId, cost: "6000" }));
    // No arr supplied → defaults to the company's annualValue (1000).
    await addConversion(fd({ eventId, companyId: companyAId }));

    const conv = await withOrg(orgA.id, (tx) =>
      tx.eventConversion.findFirst({ where: { eventId } }),
    );
    expect(conv?.companyId).toBe(companyAId);
    expect(conv?.name).toBe("Member A");
    expect(Number(conv?.arr)).toBe(1000);

    const ev = await withOrg(orgA.id, (tx) =>
      tx.event.findUnique({ where: { id: eventId }, select: { cost: true } }),
    );
    expect(Number(ev?.cost)).toBe(6000);

    // Remove it — scoped delete.
    await removeConversion(fd({ eventId, conversionId: conv!.id }));
    const after = await withOrg(orgA.id, (tx) =>
      tx.eventConversion.findMany({ where: { eventId } }),
    );
    expect(after).toHaveLength(0);
  });

  test("refuses a conversion for a company in another tenant", async () => {
    const eventId = await findEventId("ROI Event");
    const bCompanyId = (await withOrg(orgB.id, (tx) =>
      tx.company.findFirst({ where: { name: "Member B" }, select: { id: true } }),
    ))!.id;
    await expect(
      addConversion(fd({ eventId, companyId: bCompanyId })),
    ).rejects.toThrow();
  });

  test("the persisted event is invisible to another tenant (RLS)", async () => {
    const seenByB = await withOrg(orgB.id, (tx) =>
      tx.event.findMany({ where: { name: "Fall Dinner" } }),
    );
    expect(seenByB).toEqual([]);
  });

  test("finds a connection-graph target for a current guest's company", async () => {
    const eventId = await findEventId("Fall Dinner");
    // A second orgA member connected to the invited Member A (via Alice) through
    // an active introduction — the warm target we expect surfaced.
    const connectorContactId = await withOrg(orgA.id, async (tx) => {
      const connector = await tx.company.create({
        data: {
          orgId: orgA.id,
          name: "Connector Co",
          status: "member",
          industry: "Capital",
          annualValue: 1000,
          contacts: { create: { orgId: orgA.id, name: "Dana C", isPrimary: true } },
        },
        include: { contacts: true },
      });
      await tx.introduction.create({
        data: {
          orgId: orgA.id,
          partyAContactId: aliceId,
          partyBContactId: connector.contacts[0].id,
          status: "made",
          source: "manual",
        },
      });
      return connector.contacts[0].id;
    });

    const state = await findEventTargets({ status: "idle" }, fd({ eventId }));
    expect(state.status).toBe("ok");
    if (state.status !== "ok") return;
    expect(state.guestCount).toBeGreaterThanOrEqual(1);
    const connector = state.suggestions.find((s) => s.org === "Connector Co");
    expect(connector).toBeDefined();
    expect(connector!.contactId).toBe(connectorContactId);
    expect(connector!.edges).toEqual([
      { type: "intro", label: "Introduced to Member A (Made)" },
    ]);
    // No other tenant's company is ever suggested (RLS).
    expect(state.suggestions.some((s) => s.org === "Member B")).toBe(false);
  });
});
