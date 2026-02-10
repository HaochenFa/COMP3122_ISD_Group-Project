"use server";

import { getClassAccess, requireAuthenticatedUser } from "@/lib/activities/access";
import { generateGroundedChatResponse } from "@/lib/chat/generate";
import type {
  ChatModelResponse,
  ChatTurn,
  ClassChatMessage,
  ClassChatParticipant,
  ClassChatSession,
} from "@/lib/chat/types";
import { MAX_CHAT_TURNS, parseChatMessage } from "@/lib/chat/validation";

type ActionResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
    };

type SessionRow = {
  id: string;
  class_id: string;
  owner_user_id: string;
  title: string;
  is_pinned: boolean;
  archived_at: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  class_id: string;
  author_user_id: string | null;
  author_kind: "student" | "teacher" | "assistant";
  content: string;
  citations: unknown;
  safety: "ok" | "refusal" | null;
  provider: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  created_at: string;
};

function normalizeSession(row: SessionRow): ClassChatSession {
  return {
    id: row.id,
    classId: row.class_id,
    ownerUserId: row.owner_user_id,
    title: row.title,
    isPinned: row.is_pinned,
    archivedAt: row.archived_at,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeCitations(raw: unknown): { sourceLabel: string; snippet?: string }[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((item): item is { sourceLabel: string; snippet?: string } => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const sourceLabel = (item as { sourceLabel?: unknown }).sourceLabel;
      const snippet = (item as { snippet?: unknown }).snippet;
      return (
        typeof sourceLabel === "string" &&
        sourceLabel.trim().length > 0 &&
        (typeof snippet === "undefined" || typeof snippet === "string")
      );
    })
    .map((item) => ({
      sourceLabel: item.sourceLabel.trim(),
      snippet: item.snippet?.trim() || undefined,
    }));
}

function normalizeMessage(row: MessageRow): ClassChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    classId: row.class_id,
    authorUserId: row.author_user_id,
    authorKind: row.author_kind,
    content: row.content,
    citations: normalizeCitations(row.citations),
    safety: row.safety,
    provider: row.provider,
    model: row.model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
  };
}

async function resolveAccess(classId: string) {
  const { supabase, user, authError } = await requireAuthenticatedUser();

  if (!user) {
    return {
      ok: false as const,
      error: "Please sign in to use class chat.",
    };
  }
  if (authError) {
    return {
      ok: false as const,
      error: authError,
    };
  }

  const role = await getClassAccess(supabase, classId, user.id);
  if (!role.found || !role.isMember) {
    return {
      ok: false as const,
      error: "Class access required.",
    };
  }

  return {
    ok: true as const,
    supabase,
    user,
    role,
  };
}

async function resolveOwnerUserId(input: {
  classId: string;
  requestedOwnerUserId?: string;
  currentUserId: string;
  isTeacher: boolean;
  supabase: Awaited<ReturnType<typeof requireAuthenticatedUser>>["supabase"];
}) {
  const requestedOwnerUserId = input.requestedOwnerUserId?.trim();
  if (!requestedOwnerUserId || requestedOwnerUserId === input.currentUserId) {
    return { ok: true as const, ownerUserId: input.currentUserId };
  }

  if (!input.isTeacher) {
    return {
      ok: false as const,
      error: "Teacher access is required to view another student's chat.",
    };
  }

  const { data: enrollment, error } = await input.supabase
    .from("enrollments")
    .select("user_id")
    .eq("class_id", input.classId)
    .eq("user_id", requestedOwnerUserId)
    .maybeSingle();

  if (error) {
    return { ok: false as const, error: error.message };
  }

  if (!enrollment) {
    return {
      ok: false as const,
      error: "Selected user is not enrolled in this class.",
    };
  }

  return { ok: true as const, ownerUserId: requestedOwnerUserId };
}

async function getSessionWithAccess(input: {
  classId: string;
  sessionId: string;
  supabase: Awaited<ReturnType<typeof requireAuthenticatedUser>>["supabase"];
}) {
  const { data: session, error } = await input.supabase
    .from("class_chat_sessions")
    .select("id,class_id,owner_user_id,title,is_pinned,archived_at,last_message_at,created_at,updated_at")
    .eq("class_id", input.classId)
    .eq("id", input.sessionId)
    .maybeSingle<SessionRow>();

  if (error) {
    return { ok: false as const, error: error.message };
  }

  if (!session) {
    return { ok: false as const, error: "Chat session not found." };
  }

  return { ok: true as const, session: normalizeSession(session) };
}

export async function listClassChatParticipants(
  classId: string,
): Promise<ActionResult<{ participants: ClassChatParticipant[] }>> {
  const access = await resolveAccess(classId);
  if (!access.ok) {
    return access;
  }

  if (!access.role.isTeacher) {
    return {
      ok: false,
      error: "Teacher access is required to monitor student chats.",
    };
  }

  const { data: enrollments, error: enrollmentsError } = await access.supabase
    .from("enrollments")
    .select("user_id")
    .eq("class_id", classId)
    .eq("role", "student")
    .order("joined_at", { ascending: true });

  if (enrollmentsError) {
    return {
      ok: false,
      error: enrollmentsError.message,
    };
  }

  const userIds = (enrollments ?? []).map((item) => item.user_id);
  if (userIds.length === 0) {
    return {
      ok: true,
      data: {
        participants: [],
      },
    };
  }

  const { data: profiles, error: profilesError } = await access.supabase
    .from("profiles")
    .select("id,display_name")
    .in("id", userIds);

  if (profilesError) {
    return {
      ok: false,
      error: profilesError.message,
    };
  }

  const profileById = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile.display_name?.trim() || ""]),
  );

  const participants = userIds.map((userId, index) => {
    const displayName = profileById.get(userId);
    return {
      userId,
      displayName: displayName || `Student ${index + 1}`,
    } satisfies ClassChatParticipant;
  });

  return {
    ok: true,
    data: {
      participants,
    },
  };
}

export async function listClassChatSessions(
  classId: string,
  ownerUserId?: string,
): Promise<ActionResult<{ sessions: ClassChatSession[] }>> {
  const access = await resolveAccess(classId);
  if (!access.ok) {
    return access;
  }

  const owner = await resolveOwnerUserId({
    classId,
    requestedOwnerUserId: ownerUserId,
    currentUserId: access.user.id,
    isTeacher: access.role.isTeacher,
    supabase: access.supabase,
  });

  if (!owner.ok) {
    return owner;
  }

  const { data: sessions, error } = await access.supabase
    .from("class_chat_sessions")
    .select("id,class_id,owner_user_id,title,is_pinned,archived_at,last_message_at,created_at,updated_at")
    .eq("class_id", classId)
    .eq("owner_user_id", owner.ownerUserId)
    .is("archived_at", null)
    .order("is_pinned", { ascending: false })
    .order("last_message_at", { ascending: false })
    .limit(100);

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  return {
    ok: true,
    data: {
      sessions: (sessions ?? []).map((session) => normalizeSession(session as SessionRow)),
    },
  };
}

export async function createClassChatSession(
  classId: string,
  title?: string,
): Promise<ActionResult<{ session: ClassChatSession }>> {
  const access = await resolveAccess(classId);
  if (!access.ok) {
    return access;
  }

  const normalizedTitle = title?.trim() || "New chat";
  const safeTitle = normalizedTitle.slice(0, 120);

  const { data: session, error } = await access.supabase
    .from("class_chat_sessions")
    .insert({
      class_id: classId,
      owner_user_id: access.user.id,
      title: safeTitle,
      last_message_at: new Date().toISOString(),
    })
    .select("id,class_id,owner_user_id,title,is_pinned,archived_at,last_message_at,created_at,updated_at")
    .single<SessionRow>();

  if (error || !session) {
    return {
      ok: false,
      error: error?.message ?? "Failed to create chat session.",
    };
  }

  return {
    ok: true,
    data: {
      session: normalizeSession(session),
    },
  };
}

export async function renameClassChatSession(
  classId: string,
  sessionId: string,
  title: string,
): Promise<ActionResult<{ session: ClassChatSession }>> {
  const access = await resolveAccess(classId);
  if (!access.ok) {
    return access;
  }

  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return {
      ok: false,
      error: "Session title is required.",
    };
  }

  const { data: session, error } = await access.supabase
    .from("class_chat_sessions")
    .update({
      title: normalizedTitle.slice(0, 120),
    })
    .eq("class_id", classId)
    .eq("id", sessionId)
    .eq("owner_user_id", access.user.id)
    .is("archived_at", null)
    .select("id,class_id,owner_user_id,title,is_pinned,archived_at,last_message_at,created_at,updated_at")
    .single<SessionRow>();

  if (error || !session) {
    return {
      ok: false,
      error: error?.message ?? "Unable to rename chat session.",
    };
  }

  return {
    ok: true,
    data: {
      session: normalizeSession(session),
    },
  };
}

export async function archiveClassChatSession(
  classId: string,
  sessionId: string,
): Promise<ActionResult<{ sessionId: string }>> {
  const access = await resolveAccess(classId);
  if (!access.ok) {
    return access;
  }

  const { error } = await access.supabase
    .from("class_chat_sessions")
    .update({
      archived_at: new Date().toISOString(),
    })
    .eq("class_id", classId)
    .eq("id", sessionId)
    .eq("owner_user_id", access.user.id)
    .is("archived_at", null);

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  return {
    ok: true,
    data: {
      sessionId,
    },
  };
}

export async function listClassChatMessages(
  classId: string,
  sessionId: string,
  ownerUserId?: string,
): Promise<ActionResult<{ session: ClassChatSession; messages: ClassChatMessage[] }>> {
  const access = await resolveAccess(classId);
  if (!access.ok) {
    return access;
  }

  const owner = await resolveOwnerUserId({
    classId,
    requestedOwnerUserId: ownerUserId,
    currentUserId: access.user.id,
    isTeacher: access.role.isTeacher,
    supabase: access.supabase,
  });
  if (!owner.ok) {
    return owner;
  }

  const sessionResult = await getSessionWithAccess({
    classId,
    sessionId,
    supabase: access.supabase,
  });
  if (!sessionResult.ok) {
    return sessionResult;
  }

  if (sessionResult.session.ownerUserId !== owner.ownerUserId) {
    return {
      ok: false,
      error: "Chat session does not belong to the selected user.",
    };
  }

  const { data: rows, error } = await access.supabase
    .from("class_chat_messages")
    .select(
      "id,session_id,class_id,author_user_id,author_kind,content,citations,safety,provider,model,prompt_tokens,completion_tokens,total_tokens,latency_ms,created_at",
    )
    .eq("class_id", classId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(400);

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  return {
    ok: true,
    data: {
      session: sessionResult.session,
      messages: (rows ?? []).map((row) => normalizeMessage(row as MessageRow)),
    },
  };
}

function messagesToTranscript(messages: ClassChatMessage[]): ChatTurn[] {
  return messages
    .slice(-MAX_CHAT_TURNS)
    .map((message) => ({
      role: message.authorKind === "assistant" ? "assistant" : "student",
      message: message.content,
      createdAt: message.createdAt,
      citations: message.authorKind === "assistant" ? message.citations : undefined,
    }));
}

export async function sendClassChatMessage(
  classId: string,
  sessionId: string,
  formData: FormData,
): Promise<
  ActionResult<{
    response: ChatModelResponse;
    userMessage: ClassChatMessage;
    assistantMessage: ClassChatMessage;
  }>
> {
  const access = await resolveAccess(classId);
  if (!access.ok) {
    return access;
  }

  let message: string;
  try {
    message = parseChatMessage(formData.get("message"));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Message is invalid.",
    };
  }

  const sessionResult = await getSessionWithAccess({
    classId,
    sessionId,
    supabase: access.supabase,
  });

  if (!sessionResult.ok) {
    return sessionResult;
  }

  if (sessionResult.session.ownerUserId !== access.user.id) {
    return {
      ok: false,
      error: "You can only send messages in your own chat sessions.",
    };
  }

  const { data: contextRows, error: contextError } = await access.supabase
    .from("class_chat_messages")
    .select(
      "id,session_id,class_id,author_user_id,author_kind,content,citations,safety,provider,model,prompt_tokens,completion_tokens,total_tokens,latency_ms,created_at",
    )
    .eq("class_id", classId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(MAX_CHAT_TURNS);

  if (contextError) {
    return {
      ok: false,
      error: contextError.message,
    };
  }

  const transcript = messagesToTranscript((contextRows ?? []).map((row) => normalizeMessage(row as MessageRow)));

  const response = await generateGroundedChatResponse({
    classId,
    classTitle: access.role.classTitle,
    userId: access.user.id,
    userMessage: message,
    transcript,
    purpose: access.role.isTeacher ? "teacher_chat_always_on_v1" : "student_chat_always_on_v1",
  });

  const now = new Date().toISOString();
  const authorKind = access.role.isTeacher ? "teacher" : "student";
  const userMessageId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();

  const userRow: MessageRow = {
    id: userMessageId,
    session_id: sessionId,
    class_id: classId,
    author_user_id: access.user.id,
    author_kind: authorKind,
    content: message,
    citations: [],
    safety: null,
    provider: null,
    model: null,
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    latency_ms: null,
    created_at: now,
  };

  const assistantRow: MessageRow = {
    id: assistantMessageId,
    session_id: sessionId,
    class_id: classId,
    author_user_id: null,
    author_kind: "assistant",
    content: response.answer,
    citations: response.citations.map((citation) => ({
      sourceLabel: citation.sourceLabel,
      snippet: citation.rationale,
    })),
    safety: response.safety,
    provider: null,
    model: null,
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    latency_ms: null,
    created_at: now,
  };

  const { error: insertError } = await access.supabase.from("class_chat_messages").insert([
    {
      id: userRow.id,
      session_id: userRow.session_id,
      class_id: userRow.class_id,
      author_user_id: userRow.author_user_id,
      author_kind: userRow.author_kind,
      content: userRow.content,
      citations: userRow.citations,
      safety: userRow.safety,
      provider: userRow.provider,
      model: userRow.model,
      prompt_tokens: userRow.prompt_tokens,
      completion_tokens: userRow.completion_tokens,
      total_tokens: userRow.total_tokens,
      latency_ms: userRow.latency_ms,
      created_at: userRow.created_at,
    },
    {
      id: assistantRow.id,
      session_id: assistantRow.session_id,
      class_id: assistantRow.class_id,
      author_user_id: assistantRow.author_user_id,
      author_kind: assistantRow.author_kind,
      content: assistantRow.content,
      citations: assistantRow.citations,
      safety: assistantRow.safety,
      provider: assistantRow.provider,
      model: assistantRow.model,
      prompt_tokens: assistantRow.prompt_tokens,
      completion_tokens: assistantRow.completion_tokens,
      total_tokens: assistantRow.total_tokens,
      latency_ms: assistantRow.latency_ms,
      created_at: assistantRow.created_at,
    },
  ]);

  if (insertError) {
    return {
      ok: false,
      error: insertError.message,
    };
  }

  const { error: sessionUpdateError } = await access.supabase
    .from("class_chat_sessions")
    .update({
      last_message_at: now,
    })
    .eq("id", sessionId)
    .eq("class_id", classId)
    .eq("owner_user_id", access.user.id);

  if (sessionUpdateError) {
    return {
      ok: false,
      error: sessionUpdateError.message,
    };
  }

  return {
    ok: true,
    data: {
      response,
      userMessage: normalizeMessage(userRow),
      assistantMessage: normalizeMessage(assistantRow),
    },
  };
}
