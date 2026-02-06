import { describe, expect, it } from "vitest";
import {
  buildChatAssignmentSubmissionContent,
  MAX_CHAT_MESSAGE_CHARS,
  MAX_CHAT_TURNS,
  MAX_REFLECTION_CHARS,
  parseChatMessage,
  parseChatModelResponse,
  parseChatTurns,
  parseOptionalScore,
  parseReflection,
} from "@/lib/chat/validation";

describe("chat validation", () => {
  it("parses a valid chat message", () => {
    expect(parseChatMessage("  Explain limits  ")).toBe("Explain limits");
  });

  it("rejects long chat messages", () => {
    const raw = "x".repeat(MAX_CHAT_MESSAGE_CHARS + 1);
    expect(() => parseChatMessage(raw)).toThrow("Message exceeds");
  });

  it("parses transcript turns", () => {
    const turns = parseChatTurns(
      JSON.stringify([
        {
          role: "student",
          message: "What is a derivative?",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]?.role).toBe("student");
  });

  it("rejects transcript beyond turn limit", () => {
    const turns = Array.from({ length: MAX_CHAT_TURNS + 1 }, (_, index) => ({
      role: "student",
      message: `Turn ${index}`,
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    expect(() => parseChatTurns(JSON.stringify(turns))).toThrow("Transcript cannot exceed");
  });

  it("parses model response JSON deterministically", () => {
    const parsed = parseChatModelResponse(
      JSON.stringify({
        safety: "ok",
        answer: "Use the limit definition first.",
        citations: [{ sourceLabel: "Source 1", rationale: "Defines formal limit notation." }],
      }),
    );
    expect(parsed.safety).toBe("ok");
    expect(parsed.citations[0]?.sourceLabel).toBe("Source 1");
  });

  it("rejects invalid model safety values", () => {
    expect(() =>
      parseChatModelResponse(
        JSON.stringify({
          safety: "unsafe",
          answer: "No",
          citations: [],
        }),
      ),
    ).toThrow("Model response safety");
  });

  it("enforces reflection size and non-empty requirement", () => {
    expect(parseReflection("  I learned chain rule setup. ")).toBe("I learned chain rule setup.");
    expect(() => parseReflection(" ")).toThrow("Reflection is required");
    expect(() => parseReflection("x".repeat(MAX_REFLECTION_CHARS + 1))).toThrow(
      "Reflection exceeds",
    );
  });

  it("parses optional score within bounds", () => {
    expect(parseOptionalScore("88")).toBe(88);
    expect(parseOptionalScore("")).toBeNull();
    expect(() => parseOptionalScore("101")).toThrow("between 0 and 100");
  });

  it("builds assignment submission content", () => {
    const content = buildChatAssignmentSubmissionContent({
      activityId: "activity-1",
      transcript: [
        {
          role: "student",
          message: "How does this work?",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      reflection: "I should review prerequisites first.",
    });

    expect(content.mode).toBe("chat_assignment");
    expect(content.activityId).toBe("activity-1");
    expect(content.transcript).toHaveLength(1);
    expect(content.reflection).toContain("review");
  });
});
