"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  archiveClassChatSession,
  createClassChatSession,
  listClassChatMessages,
  listClassChatSessions,
  sendClassChatMessage,
} from "@/app/classes/[classId]/chat/workspace-actions";
import type { ClassChatMessage, ClassChatSession } from "@/lib/chat/types";
import { MAX_CHAT_MESSAGE_CHARS } from "@/lib/chat/validation";

type ClassChatWorkspaceProps = {
  classId: string;
  ownerUserId?: string;
  readOnly?: boolean;
  heading?: string;
};

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ClassChatWorkspace({
  classId,
  ownerUserId,
  readOnly = false,
  heading,
}: ClassChatWorkspaceProps) {
  const [sessions, setSessions] = useState<ClassChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ClassChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSessionPending, startSessionTransition] = useTransition();
  const endOfMessagesRef = useRef<HTMLDivElement | null>(null);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    startSessionTransition(async () => {
      setError(null);
      const result = await listClassChatSessions(classId, ownerUserId);
      if (!result.ok) {
        setError(result.error);
        setSessions([]);
        setSelectedSessionId(null);
        setMessages([]);
        return;
      }

      const nextSessions = result.data.sessions;
      setSessions(nextSessions);

      if (nextSessions.length === 0 && !readOnly) {
        const created = await createClassChatSession(classId);
        if (!created.ok) {
          setError(created.error);
          return;
        }
        setSessions([created.data.session]);
        setSelectedSessionId(created.data.session.id);
        return;
      }

      setSelectedSessionId((current) => {
        if (current && nextSessions.some((session) => session.id === current)) {
          return current;
        }
        if (!nextSessions[0]?.id) {
          setMessages([]);
        }
        return nextSessions[0]?.id ?? null;
      });
    });
  }, [classId, ownerUserId, readOnly]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }

    startSessionTransition(async () => {
      const result = await listClassChatMessages(classId, selectedSessionId, ownerUserId);
      if (!result.ok) {
        setError(result.error);
        setMessages([]);
        return;
      }
      setError(null);
      setMessages(result.data.messages);
    });
  }, [classId, selectedSessionId, ownerUserId]);

  const handleNewChat = () => {
    if (readOnly) {
      return;
    }
    startSessionTransition(async () => {
      const result = await createClassChatSession(classId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSessions((current) => [result.data.session, ...current]);
      setSelectedSessionId(result.data.session.id);
      setMessages([]);
      setError(null);
    });
  };

  const handleArchiveSession = (sessionId: string) => {
    if (readOnly) {
      return;
    }
    startSessionTransition(async () => {
      const result = await archiveClassChatSession(classId, sessionId);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setSessions((current) => {
        const remainingSessions = current.filter((session) => session.id !== result.data.sessionId);
        setSelectedSessionId((currentSelectedSessionId) => {
          if (currentSelectedSessionId !== result.data.sessionId) {
            return currentSelectedSessionId;
          }
          setMessages([]);
          return remainingSessions[0]?.id ?? null;
        });
        return remainingSessions;
      });
    });
  };

  const handleSend = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly || !selectedSessionId) {
      return;
    }

    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    startTransition(async () => {
      setError(null);
      const formData = new FormData();
      formData.set("message", trimmed);

      const result = await sendClassChatMessage(classId, selectedSessionId, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setMessages((current) => [...current, result.data.userMessage, result.data.assistantMessage]);
      setSessions((current) => {
        const target = current.find((session) => session.id === selectedSessionId);
        if (!target) {
          return current;
        }

        const updated = {
          ...target,
          lastMessageAt: result.data.assistantMessage.createdAt,
        };

        return [updated, ...current.filter((session) => session.id !== selectedSessionId)];
      });
      setMessage("");
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="rounded-3xl border border-white/10 bg-slate-900/70 p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Chats</h3>
          {!readOnly ? (
            <button
              type="button"
              onClick={handleNewChat}
              className="rounded-lg border border-cyan-400/40 px-2.5 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/10"
            >
              New
            </button>
          ) : null}
        </div>

        <div className="space-y-2">
          {sessions.length > 0 ? (
            sessions.map((session) => {
              const isSelected = selectedSessionId === session.id;
              return (
                <div
                  key={session.id}
                  className={`rounded-xl border px-3 py-2 ${
                    isSelected
                      ? "border-cyan-400/50 bg-cyan-400/10"
                      : "border-white/10 bg-slate-950/50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedSessionId(session.id)}
                    className="w-full text-left"
                  >
                    <p className="truncate text-sm font-medium text-slate-100">{session.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{formatDateTime(session.lastMessageAt)}</p>
                  </button>
                  {!readOnly ? (
                    <button
                      type="button"
                      onClick={() => handleArchiveSession(session.id)}
                      className="mt-2 text-xs text-rose-300 hover:text-rose-200"
                    >
                      Archive
                    </button>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="rounded-xl border border-dashed border-white/10 bg-slate-950/40 p-3 text-xs text-slate-500">
              {isSessionPending ? "Loading chats..." : "No chat sessions yet."}
            </p>
          )}
        </div>
      </aside>

      <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4">
        <header className="mb-4 border-b border-white/10 pb-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Always-on AI Chat</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-100">
            {heading || selectedSession?.title || "Class conversation"}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Chat responses are grounded in your published blueprint and class materials.
          </p>
        </header>

        {error ? (
          <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="max-h-[32rem] space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/60 p-4">
          {messages.length === 0 ? (
            <p className="text-sm text-slate-400">
              {isSessionPending ? "Loading conversation..." : "Start the conversation with a focused question."}
            </p>
          ) : (
            messages.map((turn) => (
              <article
                key={turn.id}
                className={`rounded-2xl border p-4 ${
                  turn.authorKind === "assistant"
                    ? "border-white/10 bg-slate-900 text-slate-100"
                    : "border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
                }`}
              >
                <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.2em]">
                  <span>
                    {turn.authorKind === "assistant"
                      ? "AI Tutor"
                      : turn.authorKind === "teacher"
                        ? "Teacher"
                        : "You"}
                  </span>
                  <span className="text-slate-400">{formatTime(turn.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{turn.content}</p>
                {turn.citations.length > 0 ? (
                  <ul className="mt-3 space-y-1 text-xs text-slate-400">
                    {turn.citations.map((citation) => (
                      <li key={`${turn.id}-${citation.sourceLabel}-${citation.snippet ?? ""}`}>
                        {citation.sourceLabel}
                        {citation.snippet ? `: ${citation.snippet}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))
          )}
          <div ref={endOfMessagesRef} />
        </div>

        {!readOnly ? (
          <form className="mt-4 space-y-3" onSubmit={handleSend}>
            <label className="text-sm text-slate-300" htmlFor="always-on-chat-message">
              Message
            </label>
            <textarea
              id="always-on-chat-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={MAX_CHAT_MESSAGE_CHARS}
              rows={4}
              placeholder="Ask a question to learn, review, or consolidate your understanding..."
              className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                {message.length}/{MAX_CHAT_MESSAGE_CHARS}
              </p>
              <button
                type="submit"
                disabled={isPending || !message.trim() || !selectedSessionId}
                className="rounded-xl bg-cyan-400/90 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:bg-cyan-400/40"
              >
                {isPending ? "Thinking..." : "Send"}
              </button>
            </div>
          </form>
        ) : (
          <p className="mt-4 rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-xs text-slate-400">
            Read-only monitor mode. Students can continue chatting in their own workspace.
          </p>
        )}
      </section>
    </div>
  );
}
