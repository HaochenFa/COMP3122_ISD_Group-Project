import { redirect } from "next/navigation";
import AuthHeader from "@/app/components/AuthHeader";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { reviewChatSubmission } from "@/app/classes/[classId]/chat/actions";
import type { ChatTurn } from "@/lib/chat/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = {
  created?: string;
  saved?: string;
  error?: string;
};

type ParsedSubmission = {
  transcript: ChatTurn[];
  reflection: string;
};

function parseSubmissionContent(content: unknown): ParsedSubmission {
  if (!content || typeof content !== "object") {
    return { transcript: [], reflection: "" };
  }

  const transcript = Array.isArray((content as { transcript?: unknown }).transcript)
    ? ((content as { transcript: unknown[] }).transcript
        .filter((turn): turn is ChatTurn => {
          if (!turn || typeof turn !== "object") {
            return false;
          }
          const role = (turn as { role?: unknown }).role;
          const message = (turn as { message?: unknown }).message;
          const createdAt = (turn as { createdAt?: unknown }).createdAt;
          return (
            (role === "student" || role === "assistant") &&
            typeof message === "string" &&
            typeof createdAt === "string"
          );
        })
        .map((turn) => ({
          role: turn.role,
          message: turn.message,
          createdAt: turn.createdAt,
          citations: Array.isArray(turn.citations) ? turn.citations : undefined,
        })) as ChatTurn[])
    : [];

  const reflectionRaw = (content as { reflection?: unknown }).reflection;
  return {
    transcript,
    reflection: typeof reflectionRaw === "string" ? reflectionRaw : "",
  };
}

export default async function AssignmentReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string; assignmentId: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { classId, assignmentId } = await params;
  const resolvedSearchParams = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: classRow } = await supabase
    .from("classes")
    .select("id,title,owner_id")
    .eq("id", classId)
    .single();

  if (!classRow) {
    redirect("/dashboard");
  }

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("role")
    .eq("class_id", classId)
    .eq("user_id", user.id)
    .single();

  const isTeacher =
    classRow.owner_id === user.id || enrollment?.role === "teacher" || enrollment?.role === "ta";
  if (!isTeacher) {
    redirect(`/classes/${classId}?error=${encodeURIComponent("Teacher access required.")}`);
  }

  const { data: assignment } = await supabase
    .from("assignments")
    .select("id,class_id,activity_id,due_at,created_at")
    .eq("id", assignmentId)
    .eq("class_id", classId)
    .single();

  if (!assignment) {
    redirect(`/classes/${classId}?error=${encodeURIComponent("Assignment not found.")}`);
  }

  const { data: activity } = await supabase
    .from("activities")
    .select("id,title,type,config")
    .eq("id", assignment.activity_id)
    .eq("class_id", classId)
    .single();

  if (!activity || activity.type !== "chat") {
    redirect(`/classes/${classId}?error=${encodeURIComponent("Chat activity not found.")}`);
  }

  const { data: recipients } = await supabase
    .from("assignment_recipients")
    .select("student_id,status,assigned_at")
    .eq("assignment_id", assignmentId)
    .order("assigned_at", { ascending: true });

  const recipientIds = recipients?.map((recipient) => recipient.student_id) ?? [];
  const { data: submissions } =
    recipientIds.length > 0
      ? await supabase
          .from("submissions")
          .select("id,assignment_id,student_id,content,score,submitted_at")
          .eq("assignment_id", assignmentId)
      : { data: null };

  const submissionByStudentId = new Map(
    (submissions ?? []).map((submission) => [submission.student_id, submission]),
  );

  const submissionIds = (submissions ?? []).map((submission) => submission.id);
  const { data: feedbackRows } =
    submissionIds.length > 0
      ? await supabase
          .from("feedback")
          .select("submission_id,content,created_at")
          .in("submission_id", submissionIds)
          .eq("source", "teacher")
          .order("created_at", { ascending: false })
      : { data: null };

  const latestFeedbackBySubmission = new Map<string, { comment: string; highlights: string[] }>();
  feedbackRows?.forEach((feedback) => {
    if (latestFeedbackBySubmission.has(feedback.submission_id)) {
      return;
    }
    const content = feedback.content as { comment?: unknown; highlights?: unknown };
    latestFeedbackBySubmission.set(feedback.submission_id, {
      comment: typeof content?.comment === "string" ? content.comment : "",
      highlights: Array.isArray(content?.highlights)
        ? content.highlights.filter((value): value is string => typeof value === "string")
        : [],
    });
  });

  const createdMessage =
    resolvedSearchParams?.created === "1"
      ? "Chat assignment created and assigned to the class."
      : null;
  const savedMessage =
    resolvedSearchParams?.saved === "1" ? "Feedback saved for this submission." : null;
  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AuthHeader
        activeNav="dashboard"
        classContext={{ classId: classRow.id, isTeacher }}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: classRow.title, href: `/classes/${classRow.id}` },
          { label: "Chat Assignment Review" },
        ]}
      />

      <div className="mx-auto w-full max-w-6xl px-6 py-16">
        <header className="mb-8 space-y-2">
          <p className="text-sm font-medium text-slate-400">Teacher Review</p>
          <h1 className="text-3xl font-semibold">{activity.title}</h1>
          <p className="text-sm text-slate-400">
            {assignment.due_at
              ? `Due ${new Date(assignment.due_at).toLocaleString()}`
              : "No due date"}
          </p>
        </header>

        {createdMessage ? (
          <div className="mb-6 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            {createdMessage}
          </div>
        ) : null}
        {savedMessage ? (
          <div className="mb-6 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {savedMessage}
          </div>
        ) : null}
        {errorMessage ? (
          <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {errorMessage}
          </div>
        ) : null}

        <div className="space-y-6">
          {(recipients ?? []).length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/40 p-6 text-sm text-slate-400">
              No students are currently assigned to this activity.
            </div>
          ) : (
            recipients!.map((recipient) => {
              const submission = submissionByStudentId.get(recipient.student_id);
              const parsed = parseSubmissionContent(submission?.content);
              const feedback = submission ? latestFeedbackBySubmission.get(submission.id) : null;

              return (
                <section
                  key={`${recipient.student_id}-${recipient.assigned_at}`}
                  className="rounded-3xl border border-white/10 bg-slate-900/70 p-6"
                >
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                        Student
                      </p>
                      <p className="text-sm font-semibold text-slate-200">{recipient.student_id}</p>
                    </div>
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
                      {recipient.status}
                    </span>
                  </div>

                  {!submission ? (
                    <p className="text-sm text-slate-400">No submission yet.</p>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                          Transcript
                        </p>
                        {parsed.transcript.length === 0 ? (
                          <p className="mt-2 text-sm text-slate-400">No transcript saved.</p>
                        ) : (
                          <div className="mt-3 space-y-3">
                            {parsed.transcript.map((turn, index) => (
                              <div
                                key={`${submission.id}-${turn.role}-${turn.createdAt}-${index}`}
                                className="rounded-xl border border-white/10 bg-slate-900/70 p-3"
                              >
                                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                                  {turn.role === "student" ? "Student" : "AI Tutor"}
                                </p>
                                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-100">
                                  {turn.message}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                          Reflection
                        </p>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-100">
                          {parsed.reflection || "No reflection submitted."}
                        </p>
                      </div>

                      <form
                        action={reviewChatSubmission.bind(null, classId, submission.id)}
                        className="space-y-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4"
                      >
                        <input type="hidden" name="assignment_id" value={assignmentId} />

                        <div className="space-y-2">
                          <label className="text-sm text-slate-300" htmlFor={`score-${submission.id}`}>
                            Score (0-100)
                          </label>
                          <input
                            id={`score-${submission.id}`}
                            type="number"
                            name="score"
                            min={0}
                            max={100}
                            defaultValue={submission.score?.toString() ?? ""}
                            className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm text-slate-300" htmlFor={`comment-${submission.id}`}>
                            Comment
                          </label>
                          <textarea
                            id={`comment-${submission.id}`}
                            name="comment"
                            rows={3}
                            defaultValue={feedback?.comment ?? ""}
                            className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm text-slate-300" htmlFor={`highlights-${submission.id}`}>
                            Highlights (one per line)
                          </label>
                          <textarea
                            id={`highlights-${submission.id}`}
                            name="highlights"
                            rows={3}
                            defaultValue={(feedback?.highlights ?? []).join("\n")}
                            className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                          />
                        </div>

                        <PendingSubmitButton
                          label="Save Review"
                          pendingLabel="Saving..."
                          className="rounded-xl bg-cyan-400/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-400/50"
                        />
                      </form>
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
