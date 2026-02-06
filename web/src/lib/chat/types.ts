export type ChatRole = "student" | "assistant";

export type ChatTurn = {
  role: ChatRole;
  message: string;
  createdAt: string;
  citations?: { sourceLabel: string; snippet?: string }[];
};

export type ChatModelResponse = {
  answer: string;
  citations: { sourceLabel: string; rationale: string }[];
  safety: "ok" | "refusal";
};

export type ChatAssignmentSubmissionContent = {
  mode: "chat_assignment";
  activityId: string;
  transcript: ChatTurn[];
  reflection: string;
  completedAt: string;
};
