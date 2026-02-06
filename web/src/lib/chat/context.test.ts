import { afterEach, describe, expect, it, vi } from "vitest";

const supabaseFromMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({
    from: supabaseFromMock,
  }),
}));

function makeBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};
  const resolveResult = () => result;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => resolveResult());
  builder.single = vi.fn(async () => resolveResult());
  builder.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(resolveResult()).then(onFulfilled, onRejected);
  return builder as unknown as {
    select: () => typeof builder;
    eq: () => typeof builder;
    order: () => typeof builder;
    limit: () => typeof builder;
    in: () => typeof builder;
    maybeSingle: () => Promise<unknown>;
    single: () => Promise<unknown>;
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadPublishedBlueprintContext", () => {
  it("rejects when class has no published blueprint", async () => {
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "blueprints") {
        return makeBuilder({ data: null, error: null });
      }
      return makeBuilder({ data: [], error: null });
    });

    const { loadPublishedBlueprintContext } = await import("@/lib/chat/context");

    await expect(loadPublishedBlueprintContext("class-1")).rejects.toThrow(
      "A published blueprint is required",
    );
  });

  it("builds a compiled blueprint context with topics/objectives", async () => {
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "blueprints") {
        return makeBuilder({
          data: { id: "bp-1", summary: "Limits then derivatives." },
          error: null,
        });
      }
      if (table === "topics") {
        return makeBuilder({
          data: [
            { id: "t1", title: "Limits", description: "Formal definitions", sequence: 1 },
            { id: "t2", title: "Derivatives", description: "Rates of change", sequence: 2 },
          ],
          error: null,
        });
      }
      if (table === "objectives") {
        return makeBuilder({
          data: [{ topic_id: "t1", statement: "Define epsilon-delta limits", level: "Analyze" }],
          error: null,
        });
      }
      return makeBuilder({ data: null, error: null });
    });

    const { loadPublishedBlueprintContext } = await import("@/lib/chat/context");
    const context = await loadPublishedBlueprintContext("class-1");

    expect(context.blueprintId).toBe("bp-1");
    expect(context.topicCount).toBe(2);
    expect(context.blueprintContext).toContain("Limits");
    expect(context.blueprintContext).toContain("epsilon-delta");
  });
});

describe("buildChatPrompt", () => {
  it("includes guardrails, blueprint, materials, and assignment mode", async () => {
    const { buildChatPrompt } = await import("@/lib/chat/context");
    const prompt = buildChatPrompt({
      classTitle: "Calculus I",
      userMessage: "How do I start this proof?",
      transcript: [
        {
          role: "student",
          message: "I am stuck.",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      blueprintContext: "Topic 1: Limits",
      materialContext: "Source 1 | Notes | page 1",
      assignmentInstructions: "Focus on formal definitions only.",
    });

    expect(prompt.system).toContain("Return JSON only");
    expect(prompt.user).toContain("Assignment instructions");
    expect(prompt.user).toContain("Topic 1: Limits");
    expect(prompt.user).toContain("Source 1");
    expect(prompt.user).toContain("Latest student message");
  });
});
