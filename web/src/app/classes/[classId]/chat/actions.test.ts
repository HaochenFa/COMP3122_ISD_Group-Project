import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createChatAssignment,
  reviewChatSubmission,
  sendAssignmentMessage,
  sendOpenPracticeMessage,
  submitChatAssignment,
} from "@/app/classes/[classId]/chat/actions";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest?: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

const {
  requireAuthenticatedUser,
  getClassAccess,
  generateTextWithFallback,
  retrieveMaterialContext,
  loadPublishedBlueprintContext,
  buildChatPrompt,
} = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  getClassAccess: vi.fn(),
  generateTextWithFallback: vi.fn(),
  retrieveMaterialContext: vi.fn(),
  loadPublishedBlueprintContext: vi.fn(),
  buildChatPrompt: vi.fn(() => ({
    system: "system",
    user: "user",
  })),
}));

vi.mock("@/lib/ai/providers", () => ({
  generateTextWithFallback,
}));

vi.mock("@/lib/activities/access", () => ({
  requireAuthenticatedUser,
  getClassAccess,
}));

vi.mock("@/lib/materials/retrieval", () => ({
  retrieveMaterialContext,
}));

vi.mock("@/lib/chat/context", () => ({
  loadPublishedBlueprintContext,
  buildChatPrompt,
}));

const supabaseAuth = {
  getUser: vi.fn(),
};
const supabaseFromMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({
    auth: supabaseAuth,
    from: supabaseFromMock,
  }),
}));

function makeBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};
  const resolveResult = () => result;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => resolveResult());
  builder.single = vi.fn(async () => resolveResult());
  builder.insert = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.delete = vi.fn(() => builder);
  builder.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(resolveResult()).then(onFulfilled, onRejected);
  return builder as unknown as {
    select: () => typeof builder;
    eq: () => typeof builder;
    in: () => typeof builder;
    order: () => typeof builder;
    limit: () => typeof builder;
    maybeSingle: () => Promise<unknown>;
    single: () => Promise<unknown>;
    insert: () => typeof builder;
    update: () => typeof builder;
    delete: () => typeof builder;
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  };
}

async function expectRedirect(action: () => Promise<void> | void, path: string) {
  try {
    await Promise.resolve().then(action);
    throw new Error("Expected redirect");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) {
      expect(String((error as { digest?: string }).digest)).toContain(`;${path};`);
      return;
    }
    throw error;
  }
}

describe("chat actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      supabase: {
        from: supabaseFromMock,
      },
      user: { id: "teacher-1" },
      profile: { id: "teacher-1", account_type: "teacher" },
      isEmailVerified: true,
      authError: null,
    } as never);
    vi.mocked(getClassAccess).mockResolvedValue({
      found: true,
      isTeacher: true,
      isMember: true,
      classTitle: "Physics",
      classOwnerId: "teacher-1",
    });
  });

  it("creates a chat assignment and assigns all students", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: { id: "teacher-1" } } });

    const recipientsBuilder = makeBuilder({ error: null });
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({
          data: { id: "class-1", title: "Physics", owner_id: "teacher-1" },
          error: null,
        });
      }
      if (table === "enrollments") {
        return makeBuilder({
          data: [{ user_id: "student-1" }, { user_id: "student-2" }],
          error: null,
        });
      }
      if (table === "blueprints") {
        return makeBuilder({ data: { id: "bp-1" }, error: null });
      }
      if (table === "activities") {
        return makeBuilder({ data: { id: "activity-1" }, error: null });
      }
      if (table === "assignments") {
        return makeBuilder({ data: { id: "assignment-1" }, error: null });
      }
      if (table === "assignment_recipients") {
        return recipientsBuilder;
      }
      return makeBuilder({ data: null, error: null });
    });

    const formData = new FormData();
    formData.set("title", "Chat Week 1");
    formData.set("instructions", "Explain inertia with two examples.");

    await expectRedirect(
      () => createChatAssignment("class-1", formData),
      "/classes/class-1/assignments/assignment-1/review?created=1",
    );

    expect(recipientsBuilder.insert).toHaveBeenCalledWith([
      {
        assignment_id: "assignment-1",
        student_id: "student-1",
        status: "assigned",
      },
      {
        assignment_id: "assignment-1",
        student_id: "student-2",
        status: "assigned",
      },
    ]);
  });

  it("blocks assignment creation when user is not a teacher", async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValueOnce({
      supabase: {
        from: supabaseFromMock,
      },
      user: { id: "student-1" },
      profile: { id: "student-1", account_type: "student" },
      isEmailVerified: true,
      authError: "This action requires a teacher account.",
    } as never);

    const formData = new FormData();
    formData.set("title", "Chat Week 1");
    formData.set("instructions", "Explain inertia.");

    await expectRedirect(
      () => createChatAssignment("class-1", formData),
      "/classes/class-1?error=This%20action%20requires%20a%20teacher%20account.",
    );
  });

  it("sends open practice chat and logs ai request", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: { id: "student-1" } } });
    const aiRequestBuilder = makeBuilder({ error: null });

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({
          data: { id: "class-1", owner_id: "teacher-1", title: "Calculus" },
          error: null,
        });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: { role: "student" }, error: null });
      }
      if (table === "ai_requests") {
        return aiRequestBuilder;
      }
      return makeBuilder({ data: null, error: null });
    });

    loadPublishedBlueprintContext.mockResolvedValueOnce({
      blueprintId: "bp-1",
      summary: "Summary",
      topicCount: 3,
      blueprintContext: "Topic 1: Limits",
    });
    retrieveMaterialContext.mockResolvedValueOnce("Source 1 | Notes | page 1");
    generateTextWithFallback.mockResolvedValueOnce({
      provider: "openrouter",
      model: "model-1",
      content: JSON.stringify({
        safety: "ok",
        answer: "Start with the definition of a limit.",
        citations: [{ sourceLabel: "Source 1", rationale: "Defines formal limit notation." }],
      }),
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      latencyMs: 12,
    });

    const formData = new FormData();
    formData.set("message", "How should I begin proving this limit?");
    formData.set("transcript", "[]");
    const result = await sendOpenPracticeMessage("class-1", formData);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.answer).toContain("definition of a limit");
    }
    expect(aiRequestBuilder.insert).toHaveBeenCalled();
  });

  it("normalizes citation label variants without misattributing unknown labels", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: { id: "student-1" } } });
    const aiRequestBuilder = makeBuilder({ error: null });

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({
          data: { id: "class-1", owner_id: "teacher-1", title: "Calculus" },
          error: null,
        });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: { role: "student" }, error: null });
      }
      if (table === "ai_requests") {
        return aiRequestBuilder;
      }
      return makeBuilder({ data: null, error: null });
    });

    loadPublishedBlueprintContext.mockResolvedValueOnce({
      blueprintId: "bp-1",
      summary: "Summary",
      topicCount: 3,
      blueprintContext: "Blueprint Context | Published blueprint context\nSummary: Limits",
    });
    retrieveMaterialContext.mockResolvedValueOnce("Source 1 | Notes | page 1");
    generateTextWithFallback.mockResolvedValueOnce({
      provider: "openrouter",
      model: "model-1",
      content: JSON.stringify({
        safety: "ok",
        answer: "Start with the definition of a limit.",
        citations: [
          { sourceLabel: "Source: Blueprint Context", rationale: "From blueprint summary." },
          { sourceLabel: "Unknown Label", rationale: "Unmatched external claim." },
        ],
      }),
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      latencyMs: 12,
    });

    const formData = new FormData();
    formData.set("message", "How should I begin proving this limit?");
    formData.set("transcript", "[]");
    const result = await sendOpenPracticeMessage("class-1", formData);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.citations[0]?.sourceLabel).toBe("Blueprint Context");
      expect(result.response.citations[1]?.sourceLabel).toBe("Unknown Label");
    }
  });

  it("blocks assignment message when student is not recipient", async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValueOnce({
      supabase: {
        from: supabaseFromMock,
      },
      user: { id: "student-1" },
      profile: { id: "student-1", account_type: "student" },
      isEmailVerified: true,
      authError: null,
    } as never);
    vi.mocked(getClassAccess).mockResolvedValueOnce({
      found: true,
      isTeacher: false,
      isMember: true,
      classTitle: "Calculus",
      classOwnerId: "teacher-1",
    });

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "assignment_recipients") {
        return makeBuilder({ data: null, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    const formData = new FormData();
    formData.set("message", "Question");
    formData.set("transcript", "[]");
    const result = await sendAssignmentMessage("class-1", "assignment-1", formData);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not assigned");
    }
  });

  it("submits a chat assignment transcript and reflection", async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValueOnce({
      supabase: {
        from: supabaseFromMock,
      },
      user: { id: "student-1" },
      profile: { id: "student-1", account_type: "student" },
      isEmailVerified: true,
      authError: null,
    } as never);

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "assignment_recipients") {
        return makeBuilder({
          data: { assignment_id: "assignment-1", status: "assigned" },
          error: null,
        });
      }
      if (table === "assignments") {
        return makeBuilder({
          data: { id: "assignment-1", class_id: "class-1", activity_id: "activity-1" },
          error: null,
        });
      }
      if (table === "activities") {
        return makeBuilder({
          data: {
            id: "activity-1",
            type: "chat",
            title: "Chat",
            config: { instructions: "Use formal notation." },
          },
          error: null,
        });
      }
      if (table === "submissions") {
        return makeBuilder({ data: null, error: null });
      }
      return makeBuilder({
        data: { id: "class-1", owner_id: "teacher-1", title: "Calculus" },
        error: null,
      });
    });

    const formData = new FormData();
    formData.set(
      "transcript",
      JSON.stringify([
        {
          role: "student",
          message: "How does this proof start?",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    );
    formData.set("reflection", "I should define epsilon before choosing delta.");

    await expectRedirect(
      () => submitChatAssignment("class-1", "assignment-1", formData),
      "/classes/class-1/assignments/assignment-1/chat?submitted=1",
    );
  });

  it("saves teacher review feedback and score", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: { id: "teacher-1" } } });
    const feedbackBuilder = makeBuilder({ error: null });

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({
          data: { id: "class-1", owner_id: "teacher-1", title: "Calculus" },
          error: null,
        });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: null, error: null });
      }
      if (table === "submissions") {
        return makeBuilder({
          data: { id: "submission-1", assignment_id: "assignment-1", student_id: "student-1" },
          error: null,
        });
      }
      if (table === "assignments") {
        return makeBuilder({
          data: { id: "assignment-1", class_id: "class-1" },
          error: null,
        });
      }
      if (table === "feedback") {
        return feedbackBuilder;
      }
      if (table === "assignment_recipients") {
        return makeBuilder({ error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    const formData = new FormData();
    formData.set("assignment_id", "assignment-1");
    formData.set("score", "92");
    formData.set("comment", "Good use of formal notation.");
    formData.set("highlights", "Strong setup\nNeeds tighter conclusion");

    await expectRedirect(
      () => reviewChatSubmission("class-1", "submission-1", formData),
      "/classes/class-1/assignments/assignment-1/review?saved=1",
    );

    expect(feedbackBuilder.insert).toHaveBeenCalledWith({
      submission_id: "submission-1",
      created_by: "teacher-1",
      source: "teacher",
      content: {
        comment: "Good use of formal notation.",
        highlights: ["Strong setup", "Needs tighter conclusion"],
      },
      is_edited: false,
    });
  });
});
