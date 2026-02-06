"use server";

import { redirect } from "next/navigation";
import { generateTextWithFallback } from "@/lib/ai/providers";
import { buildChatPrompt, loadPublishedBlueprintContext } from "@/lib/chat/context";
import type { ChatModelResponse, ChatTurn } from "@/lib/chat/types";
import {
  buildChatAssignmentSubmissionContent,
  parseChatMessage,
  parseChatModelResponse,
  parseChatTurns,
  parseDueAt,
  parseHighlights,
  parseOptionalScore,
  parseReflection,
} from "@/lib/chat/validation";
import { retrieveMaterialContext } from "@/lib/materials/retrieval";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ChatActionResult =
  | {
      ok: true;
      response: ChatModelResponse;
    }
  | {
      ok: false;
      error: string;
    };

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function redirectWithError(path: string, message: string) {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

async function requireAuthenticatedUser() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null };
  }

  return { supabase, user };
}

async function getClassRole(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  classId: string,
  userId: string,
) {
  const { data: classRow, error: classError } = await supabase
    .from("classes")
    .select("id,title,owner_id")
    .eq("id", classId)
    .single();

  if (classError || !classRow) {
    return {
      found: false as const,
      isTeacher: false,
      isMember: false,
      classTitle: "",
    };
  }

  if (classRow.owner_id === userId) {
    return {
      found: true as const,
      isTeacher: true,
      isMember: true,
      classTitle: classRow.title,
    };
  }

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("role")
    .eq("class_id", classId)
    .eq("user_id", userId)
    .single();

  const role = enrollment?.role;
  const isTeacher = role === "teacher" || role === "ta";
  const isMember = Boolean(role);

  return {
    found: true as const,
    isTeacher,
    isMember,
    classTitle: classRow.title,
  };
}

async function logChatAiRequest(input: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  classId: string;
  userId: string;
  provider: string;
  model?: string | null;
  purpose: string;
  status: string;
  latencyMs: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
}) {
  const { error } = await input.supabase.from("ai_requests").insert({
    class_id: input.classId,
    user_id: input.userId,
    provider: input.provider,
    model: input.model ?? null,
    purpose: input.purpose,
    status: input.status,
    latency_ms: input.latencyMs,
    prompt_tokens: input.promptTokens ?? null,
    completion_tokens: input.completionTokens ?? null,
    total_tokens: input.totalTokens ?? null,
  });

  if (error) {
    console.error("Failed to log chat ai request", {
      classId: input.classId,
      userId: input.userId,
      purpose: input.purpose,
      error: error.message,
    });
  }
}

async function generateChatResponse(input: {
  classId: string;
  classTitle: string;
  userId: string;
  userMessage: string;
  transcript: ChatTurn[];
  assignmentInstructions?: string | null;
  purpose: "student_chat_open" | "student_chat_assignment";
}) {
  const supabase = await createServerSupabaseClient();

  const blueprintContext = await loadPublishedBlueprintContext(input.classId);
  const retrievalQuery = input.assignmentInstructions
    ? `${input.assignmentInstructions}\n\n${input.userMessage}`
    : input.userMessage;
  const materialContext = await retrieveMaterialContext(input.classId, retrievalQuery);
  const prompt = buildChatPrompt({
    classTitle: input.classTitle,
    userMessage: input.userMessage,
    transcript: input.transcript,
    blueprintContext: blueprintContext.blueprintContext,
    materialContext,
    assignmentInstructions: input.assignmentInstructions,
  });

  const startedAt = Date.now();
  try {
    const result = await generateTextWithFallback({
      system: prompt.system,
      user: prompt.user,
      temperature: 0.2,
      maxTokens: 1200,
    });

    const parsed = parseChatModelResponse(result.content);
    await logChatAiRequest({
      supabase,
      classId: input.classId,
      userId: input.userId,
      provider: result.provider,
      model: result.model,
      purpose: input.purpose,
      status: "success",
      latencyMs: result.latencyMs,
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
      totalTokens: result.usage?.totalTokens,
    });

    return parsed;
  } catch (error) {
    await logChatAiRequest({
      supabase,
      classId: input.classId,
      userId: input.userId,
      provider: "unknown",
      purpose: input.purpose,
      status: "error",
      latencyMs: Date.now() - startedAt,
    });
    throw error;
  }
}

async function loadStudentAssignmentContext(input: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  classId: string;
  assignmentId: string;
  userId: string;
}) {
  const { data: recipient, error: recipientError } = await input.supabase
    .from("assignment_recipients")
    .select("assignment_id,status")
    .eq("assignment_id", input.assignmentId)
    .eq("student_id", input.userId)
    .maybeSingle();

  if (recipientError || !recipient) {
    throw new Error("You are not assigned to this activity.");
  }

  const { data: assignment, error: assignmentError } = await input.supabase
    .from("assignments")
    .select("id,class_id,activity_id,due_at")
    .eq("id", input.assignmentId)
    .eq("class_id", input.classId)
    .single();

  if (assignmentError || !assignment) {
    throw new Error("Assignment not found.");
  }

  const { data: activity, error: activityError } = await input.supabase
    .from("activities")
    .select("id,title,type,config")
    .eq("id", assignment.activity_id)
    .eq("class_id", input.classId)
    .single();

  if (activityError || !activity) {
    throw new Error("Assignment activity not found.");
  }

  if (activity.type !== "chat") {
    throw new Error("This assignment is not a chat activity.");
  }

  const instructions =
    typeof activity.config?.instructions === "string" ? activity.config.instructions : null;

  return {
    assignment,
    activity,
    recipient,
    instructions,
  };
}

export async function sendOpenPracticeMessage(classId: string, formData: FormData): Promise<ChatActionResult> {
  const { supabase, user } = await requireAuthenticatedUser();

  if (!user) {
    return { ok: false, error: "Please sign in to use chat." };
  }

  const role = await getClassRole(supabase, classId, user.id);
  if (!role.found || !role.isMember) {
    return { ok: false, error: "Class access required." };
  }

  let message: string;
  let transcript: ChatTurn[];
  try {
    message = parseChatMessage(formData.get("message"));
    transcript = parseChatTurns(formData.get("transcript"));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid chat payload.",
    };
  }

  try {
    const response = await generateChatResponse({
      classId,
      classTitle: role.classTitle,
      userId: user.id,
      userMessage: message,
      transcript,
      purpose: "student_chat_open",
    });

    return {
      ok: true,
      response,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to generate chat response.",
    };
  }
}

export async function createChatAssignment(classId: string, formData: FormData) {
  const { supabase, user } = await requireAuthenticatedUser();
  if (!user) {
    redirect("/login");
  }

  const role = await getClassRole(supabase, classId, user.id);
  if (!role.found || !role.isTeacher) {
    redirectWithError(`/classes/${classId}`, "Teacher access is required to create assignments.");
    return;
  }

  const title = getFormString(formData, "title");
  const instructions = getFormString(formData, "instructions");

  if (!title) {
    redirectWithError(`/classes/${classId}/activities/chat/new`, "Assignment title is required.");
    return;
  }

  if (!instructions) {
    redirectWithError(
      `/classes/${classId}/activities/chat/new`,
      "Assignment instructions are required.",
    );
    return;
  }

  let dueAt: string | null = null;
  try {
    dueAt = parseDueAt(formData.get("due_at"));
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/activities/chat/new`,
      error instanceof Error ? error.message : "Due date is invalid.",
    );
    return;
  }

  const { data: publishedBlueprint, error: publishedBlueprintError } = await supabase
    .from("blueprints")
    .select("id")
    .eq("class_id", classId)
    .eq("status", "published")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (publishedBlueprintError) {
    redirectWithError(
      `/classes/${classId}/activities/chat/new`,
      publishedBlueprintError.message,
    );
    return;
  }

  if (!publishedBlueprint) {
    redirectWithError(
      `/classes/${classId}/activities/chat/new`,
      "Publish a blueprint before creating chat assignments.",
    );
    return;
  }

  const { data: activity, error: activityError } = await supabase
    .from("activities")
    .insert({
      class_id: classId,
      blueprint_id: publishedBlueprint.id,
      type: "chat",
      title,
      config: {
        instructions,
        mode: "assignment",
      },
      status: "published",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (activityError || !activity) {
    redirectWithError(
      `/classes/${classId}/activities/chat/new`,
      activityError?.message ?? "Failed to create activity.",
    );
    return;
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .insert({
      class_id: classId,
      activity_id: activity.id,
      assigned_by: user.id,
      due_at: dueAt,
    })
    .select("id")
    .single();

  if (assignmentError || !assignment) {
    redirectWithError(
      `/classes/${classId}/activities/chat/new`,
      assignmentError?.message ?? "Failed to create assignment.",
    );
    return;
  }

  const { data: students, error: studentsError } = await supabase
    .from("enrollments")
    .select("user_id")
    .eq("class_id", classId)
    .eq("role", "student");

  if (studentsError) {
    redirectWithError(`/classes/${classId}/activities/chat/new`, studentsError.message);
    return;
  }

  if ((students ?? []).length > 0) {
    const recipients = students!.map((student) => ({
      assignment_id: assignment.id,
      student_id: student.user_id,
      status: "assigned",
    }));

    const { error: recipientsError } = await supabase.from("assignment_recipients").insert(recipients);

    if (recipientsError) {
      redirectWithError(`/classes/${classId}/activities/chat/new`, recipientsError.message);
      return;
    }
  }

  redirect(`/classes/${classId}/assignments/${assignment.id}/review?created=1`);
}

export async function sendAssignmentMessage(
  classId: string,
  assignmentId: string,
  formData: FormData,
): Promise<ChatActionResult> {
  const { supabase, user } = await requireAuthenticatedUser();

  if (!user) {
    return { ok: false, error: "Please sign in to continue." };
  }

  const role = await getClassRole(supabase, classId, user.id);
  if (!role.found || !role.isMember) {
    return { ok: false, error: "Class access required." };
  }

  let message: string;
  let transcript: ChatTurn[];
  try {
    message = parseChatMessage(formData.get("message"));
    transcript = parseChatTurns(formData.get("transcript"));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid chat payload.",
    };
  }

  let assignmentContext:
    | Awaited<ReturnType<typeof loadStudentAssignmentContext>>
    | null = null;
  try {
    assignmentContext = await loadStudentAssignmentContext({
      supabase,
      classId,
      assignmentId,
      userId: user.id,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to access assignment.",
    };
  }

  try {
    const response = await generateChatResponse({
      classId,
      classTitle: role.classTitle,
      userId: user.id,
      userMessage: message,
      transcript,
      assignmentInstructions: assignmentContext.instructions,
      purpose: "student_chat_assignment",
    });

    return {
      ok: true,
      response,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to generate chat response.",
    };
  }
}

export async function submitChatAssignment(classId: string, assignmentId: string, formData: FormData) {
  const { supabase, user } = await requireAuthenticatedUser();
  if (!user) {
    redirect("/login");
  }

  let transcript: ChatTurn[];
  let reflection: string;
  try {
    transcript = parseChatTurns(formData.get("transcript"));
    reflection = parseReflection(formData.get("reflection"));
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/chat`,
      error instanceof Error ? error.message : "Invalid submission payload.",
    );
    return;
  }

  if (transcript.length === 0) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/chat`,
      "At least one chat turn is required before submission.",
    );
    return;
  }

  let assignmentContext: Awaited<ReturnType<typeof loadStudentAssignmentContext>>;
  try {
    assignmentContext = await loadStudentAssignmentContext({
      supabase,
      classId,
      assignmentId,
      userId: user.id,
    });
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/chat`,
      error instanceof Error ? error.message : "Unable to access assignment.",
    );
    return;
  }

  const content = buildChatAssignmentSubmissionContent({
    activityId: assignmentContext.activity.id,
    transcript,
    reflection,
  });

  const { data: existingSubmission, error: existingSubmissionError } = await supabase
    .from("submissions")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("student_id", user.id)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingSubmissionError) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/chat`,
      existingSubmissionError.message,
    );
    return;
  }

  if (existingSubmission) {
    const { error: updateError } = await supabase
      .from("submissions")
      .update({
        content,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", existingSubmission.id);

    if (updateError) {
      redirectWithError(`/classes/${classId}/assignments/${assignmentId}/chat`, updateError.message);
      return;
    }
  } else {
    const { error: insertError } = await supabase.from("submissions").insert({
      assignment_id: assignmentId,
      student_id: user.id,
      content,
      submitted_at: new Date().toISOString(),
    });

    if (insertError) {
      redirectWithError(`/classes/${classId}/assignments/${assignmentId}/chat`, insertError.message);
      return;
    }
  }

  redirect(`/classes/${classId}/assignments/${assignmentId}/chat?submitted=1`);
}

export async function reviewChatSubmission(classId: string, submissionId: string, formData: FormData) {
  const { supabase, user } = await requireAuthenticatedUser();
  if (!user) {
    redirect("/login");
  }

  const assignmentId = getFormString(formData, "assignment_id");
  if (!assignmentId) {
    redirectWithError(`/classes/${classId}`, "Assignment id is required.");
    return;
  }

  const role = await getClassRole(supabase, classId, user.id);
  if (!role.found || !role.isTeacher) {
    redirectWithError(`/classes/${classId}`, "Teacher access required.");
    return;
  }

  let score: number | null;
  try {
    score = parseOptionalScore(formData.get("score"));
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/review`,
      error instanceof Error ? error.message : "Score is invalid.",
    );
    return;
  }

  const comment = getFormString(formData, "comment");
  const highlights = parseHighlights(formData.get("highlights"));

  if (!comment && highlights.length === 0) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/review`,
      "Provide a comment or at least one highlight.",
    );
    return;
  }

  const { data: submission, error: submissionError } = await supabase
    .from("submissions")
    .select("id,assignment_id,student_id")
    .eq("id", submissionId)
    .eq("assignment_id", assignmentId)
    .single();

  if (submissionError || !submission) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/review`,
      "Submission not found.",
    );
    return;
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("id,class_id")
    .eq("id", assignmentId)
    .eq("class_id", classId)
    .single();

  if (assignmentError || !assignment) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/review`,
      "Assignment not found.",
    );
    return;
  }

  const { error: scoreError } = await supabase
    .from("submissions")
    .update({ score })
    .eq("id", submission.id);

  if (scoreError) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/review`,
      scoreError.message,
    );
    return;
  }

  const { error: feedbackError } = await supabase.from("feedback").insert({
    submission_id: submission.id,
    created_by: user.id,
    source: "teacher",
    content: {
      comment: comment || "",
      highlights,
    },
    is_edited: false,
  });

  if (feedbackError) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/review`,
      feedbackError.message,
    );
    return;
  }

  await supabase
    .from("assignment_recipients")
    .update({ status: "reviewed" })
    .eq("assignment_id", assignmentId)
    .eq("student_id", submission.student_id);

  redirect(`/classes/${classId}/assignments/${assignmentId}/review?saved=1`);
}
