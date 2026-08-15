import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Action-level test for triggerEnrichment (the manual "Run enrichment" button).
// It's a thin enqueue: admin-only, and on success it sends exactly one
// coterie/linkedin.enrich event stamped with the caller's orgId. No DB — the
// Inngest send is mocked, and requireOrgContext returns a controllable ctx.

const send = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/inngest", () => ({ inngest: { send } }));

const mockCtx = vi.hoisted(() => ({
  orgId: "",
  orgName: "",
  userId: "",
  userName: "",
  userEmail: "",
  role: "admin",
}));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
  requireAdmin: vi.fn(async () => mockCtx),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { triggerEnrichment } = await import("@/app/dashboard/linkedin/actions");

beforeEach(() => {
  send.mockClear();
  mockCtx.orgId = randomUUID();
  mockCtx.role = "admin";
});

describe("triggerEnrichment", () => {
  test("an admin enqueues one enrich event for their org", async () => {
    const result = await triggerEnrichment({ status: "idle" }, new FormData());
    expect(result).toEqual({ status: "queued" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      name: "coterie/linkedin.enrich",
      data: { orgId: mockCtx.orgId },
    });
  });

  test("a non-admin is refused and nothing is enqueued", async () => {
    mockCtx.role = "staff";
    const result = await triggerEnrichment({ status: "idle" }, new FormData());
    expect(result.status).toBe("error");
    expect(send).not.toHaveBeenCalled();
  });

  test("surfaces an error when the enqueue fails", async () => {
    send.mockRejectedValueOnce(new Error("inngest down"));
    const result = await triggerEnrichment({ status: "idle" }, new FormData());
    expect(result.status).toBe("error");
  });
});
