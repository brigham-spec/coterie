import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { SopAnswer, SopAssistantInput } from "@/lib/sop-assistant";

// Action-level integration test for the Document assistant (knowledge layer).
// Runs against the real Neon DB, mocking Clerk, Next's revalidatePath (unused by
// this ephemeral action but harmless), and the Anthropic seam (generateSopAnswer)
// so no live key is needed. Proves: no documents on file short-circuits to "empty"
// WITHOUT a model call; ALL doc kinds (a deck AND a sop) are folded into the
// grounding; and — the cardinal rule — the other tenant's documents are never seen.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

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

// Capture what the seam is asked to answer from, and hand back a canned answer
// citing whatever real SOP title we planted so the citation-validation path runs.
const generateSopAnswer = vi.hoisted(() =>
  vi.fn(
    async (
      input: SopAssistantInput,
      validCitations: ReadonlySet<string>,
    ): Promise<SopAnswer> => ({
      answer: "Start with a welcome call.",
      answered: true,
      citations: [...validCitations],
    }),
  ),
);
vi.mock("@/lib/sop-assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sop-assistant")>()),
  generateSopAnswer,
}));

const { askSop } = await import("@/app/dashboard/sop-assistant/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
  mockCtx.userId = randomUUID();
  mockCtx.role = "admin";
});

afterAll(async () => {
  await prisma.organization.deleteMany({
    where: { id: { in: [orgA.id, orgB.id] } },
  });
  await prisma.$disconnect();
});

function askForm(question: string): FormData {
  const f = new FormData();
  f.set("question", question);
  return f;
}

async function seedDoc(
  orgId: string,
  kind: string,
  title: string,
  content: string,
): Promise<void> {
  await withOrg(orgId, (tx) =>
    tx.knowledgeDoc.create({
      data: { orgId, kind, title, content, charCount: content.length },
    }),
  );
}

describe("askSop", () => {
  test("errors when the question is blank", async () => {
    const result = await askSop({ status: "idle" }, askForm("   "));
    expect(result.status).toBe("error");
    expect(generateSopAnswer).not.toHaveBeenCalled();
  });

  test("returns empty (no model call) when the org has no documents on file", async () => {
    // orgA has nothing seeded yet — the grounding is empty.
    const result = await askSop(
      { status: "idle" },
      askForm("How do we onboard a new member?"),
    );
    expect(result.status).toBe("empty");
    expect(generateSopAnswer).not.toHaveBeenCalled();
  });

  test("grounds in ALL uploaded doc kinds and keeps validated citations", async () => {
    // A deck AND a sop are both folded in — no kind is filtered out.
    await seedDoc(orgA.id, "deck", "Pitch", "We connect founders to capital.");
    await seedDoc(
      orgA.id,
      "sop",
      "Onboarding",
      "Step 1: welcome call. Step 2: send packet.",
    );

    const result = await askSop(
      { status: "idle" },
      askForm("How do we onboard a new member?"),
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.answer.answered).toBe(true);
    expect(result.answer.answer).toBe("Start with a welcome call.");

    // The seam was handed BOTH the SOP body and the deck body.
    expect(generateSopAnswer).toHaveBeenCalledTimes(1);
    const [input, validCitations] = generateSopAnswer.mock.calls[0];
    expect(input.grounding).toContain("Onboarding");
    expect(input.grounding).toContain("Step 1: welcome call.");
    expect(input.grounding).toContain("Pitch");
    expect(input.grounding).toContain("connect founders to capital");
    // Citations are validated against every uploaded document title.
    expect([...validCitations].sort()).toEqual(["Onboarding", "Pitch"]);
    expect(result.answer.citations.sort()).toEqual(["Onboarding", "Pitch"]);
  });
});

describe("tenant isolation", () => {
  test("orgB never sees orgA's documents", async () => {
    generateSopAnswer.mockClear();
    // orgA has docs (seeded above); orgB has none of its own.
    mockCtx.orgId = orgB.id;
    mockCtx.orgName = orgB.name;
    try {
      const result = await askSop(
        { status: "idle" },
        askForm("How do we onboard a new member?"),
      );
      // No documents visible under orgB's RLS view → empty, no model call.
      expect(result.status).toBe("empty");
      expect(generateSopAnswer).not.toHaveBeenCalled();
    } finally {
      mockCtx.orgId = orgA.id;
      mockCtx.orgName = orgA.name;
    }
  });
});
