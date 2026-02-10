import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listClassChatParticipants,
  listClassChatSessions,
  sendClassChatMessage,
} from "@/app/classes/[classId]/chat/workspace-actions";

const { requireAuthenticatedUser, getClassAccess, generateGroundedChatResponse } = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  getClassAccess: vi.fn(),
  generateGroundedChatResponse: vi.fn(),
}));

vi.mock("@/lib/activities/access", () => ({
  requireAuthenticatedUser,
  getClassAccess,
}));

vi.mock("@/lib/chat/generate", () => ({
  generateGroundedChatResponse,
}));

function makeBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};
  const resolveResult = () => result;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => resolveResult());
  builder.single = vi.fn(async () => resolveResult());
  builder.insert = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(resolveResult()).then(onFulfilled, onRejected);
  return builder as unknown as {
    select: () => typeof builder;
    eq: () => typeof builder;
    is: () => typeof builder;
    order: () => typeof builder;
    limit: () => typeof builder;
    in: () => typeof builder;
    maybeSingle: () => Promise<unknown>;
    single: () => Promise<unknown>;
    insert: () => typeof builder;
    update: () => typeof builder;
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  };
}

describe("workspace chat actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists persistent sessions for the signed-in member", async () => {
    const supabaseFromMock = vi.fn((table: string) => {
      if (table === "class_chat_sessions") {
        return makeBuilder({
          data: [
            {
              id: "session-1",
              class_id: "class-1",
              owner_user_id: "student-1",
              title: "Limits review",
              is_pinned: false,
              archived_at: null,
              last_message_at: "2026-02-10T12:00:00.000Z",
              created_at: "2026-02-09T12:00:00.000Z",
              updated_at: "2026-02-10T12:00:00.000Z",
            },
          ],
          error: null,
        });
      }
      return makeBuilder({ data: null, error: null });
    });

    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      supabase: {
        from: supabaseFromMock,
      },
      user: { id: "student-1" },
      profile: { id: "student-1", account_type: "student" },
      isEmailVerified: true,
      authError: null,
    } as never);

    vi.mocked(getClassAccess).mockResolvedValue({
      found: true,
      isTeacher: false,
      isMember: true,
      classTitle: "Calculus",
      classOwnerId: "teacher-1",
    });

    const result = await listClassChatSessions("class-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.sessions).toHaveLength(1);
      expect(result.data.sessions[0]?.title).toBe("Limits review");
    }
  });

  it("lists student chat monitor participants for teachers", async () => {
    const supabaseFromMock = vi.fn((table: string) => {
      if (table === "enrollments") {
        return makeBuilder({
          data: [{ user_id: "student-1" }, { user_id: "student-2" }],
          error: null,
        });
      }

      if (table === "profiles") {
        return makeBuilder({
          data: [
            { id: "student-1", display_name: "Alex" },
            { id: "student-2", display_name: "Sam" },
          ],
          error: null,
        });
      }

      return makeBuilder({ data: null, error: null });
    });

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
      classTitle: "Calculus",
      classOwnerId: "teacher-1",
    });

    const result = await listClassChatParticipants("class-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.participants).toEqual([
        { userId: "student-1", displayName: "Alex" },
        { userId: "student-2", displayName: "Sam" },
      ]);
    }
  });

  it("sends a persistent class chat message and appends assistant reply", async () => {
    let messagesCall = 0;
    const insertBuilder = makeBuilder({ error: null });
    const updateBuilder = makeBuilder({ error: null });

    const supabaseFromMock = vi.fn((table: string) => {
      if (table === "class_chat_sessions") {
        const builder = messagesCall === 0
          ? makeBuilder({
              data: {
                id: "session-1",
                class_id: "class-1",
                owner_user_id: "student-1",
                title: "Limits review",
                is_pinned: false,
                archived_at: null,
                last_message_at: "2026-02-10T12:00:00.000Z",
                created_at: "2026-02-09T12:00:00.000Z",
                updated_at: "2026-02-10T12:00:00.000Z",
              },
              error: null,
            })
          : updateBuilder;
        messagesCall += 1;
        return builder;
      }

      if (table === "class_chat_messages") {
        if ((supabaseFromMock.mock.calls.filter((call) => call[0] === "class_chat_messages").length) === 1) {
          return makeBuilder({ data: [], error: null });
        }
        return insertBuilder;
      }

      return makeBuilder({ data: null, error: null });
    });

    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      supabase: {
        from: supabaseFromMock,
      },
      user: { id: "student-1" },
      profile: { id: "student-1", account_type: "student" },
      isEmailVerified: true,
      authError: null,
    } as never);

    vi.mocked(getClassAccess).mockResolvedValue({
      found: true,
      isTeacher: false,
      isMember: true,
      classTitle: "Calculus",
      classOwnerId: "teacher-1",
    });

    vi.mocked(generateGroundedChatResponse).mockResolvedValue({
      safety: "ok",
      answer: "Start by writing the epsilon-delta definition.",
      citations: [{ sourceLabel: "Blueprint Context", rationale: "Formal objective for limits." }],
    });

    const formData = new FormData();
    formData.set("message", "How do I start this proof?");

    const result = await sendClassChatMessage("class-1", "session-1", formData);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.response.answer).toContain("epsilon-delta");
      expect(result.data.assistantMessage.citations[0]?.sourceLabel).toBe("Blueprint Context");
    }

    expect(vi.mocked(generateGroundedChatResponse)).toHaveBeenCalled();
    expect(insertBuilder.insert).toHaveBeenCalled();
  });
});
