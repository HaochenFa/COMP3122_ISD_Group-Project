import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OpenPracticeChatPage from "@/app/classes/[classId]/chat/page";

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

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest?: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

function makeBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};
  const resolveResult = () => result;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.single = vi.fn(async () => resolveResult());
  builder.maybeSingle = vi.fn(async () => resolveResult());
  builder.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(resolveResult()).then(onFulfilled, onRejected);
  return builder as unknown as {
    select: () => typeof builder;
    eq: () => typeof builder;
    order: () => typeof builder;
    limit: () => typeof builder;
    single: () => Promise<unknown>;
    maybeSingle: () => Promise<unknown>;
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  };
}

describe("OpenPracticeChatPage", () => {
  it("renders chat workspace when published blueprint exists", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: { id: "u1" } } });
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({
          data: {
            id: "class-1",
            title: "Calculus",
            subject: "Math",
            level: "College",
            owner_id: "t1",
          },
          error: null,
        });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: { role: "student" }, error: null });
      }
      if (table === "blueprints") {
        return makeBuilder({ data: { id: "bp-1", version: 1 }, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    const html = renderToStaticMarkup(
      await OpenPracticeChatPage({
        params: Promise.resolve({ classId: "class-1" }),
      }),
    );

    expect(html).toContain("Open Practice Chat");
    expect(html).toContain("not saved");
  });

  it("renders blueprint required state when no published blueprint", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: { id: "u1" } } });
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({
          data: {
            id: "class-1",
            title: "Calculus",
            subject: "Math",
            level: "College",
            owner_id: "t1",
          },
          error: null,
        });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: { role: "student" }, error: null });
      }
      if (table === "blueprints") {
        return makeBuilder({ data: null, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    const html = renderToStaticMarkup(
      await OpenPracticeChatPage({
        params: Promise.resolve({ classId: "class-1" }),
      }),
    );

    expect(html).toContain("Published blueprint required");
  });
});
