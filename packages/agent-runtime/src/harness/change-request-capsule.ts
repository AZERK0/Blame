import {
  ConversationMemoryStore,
  renderContinuityPrompt,
  type CapsuleBudget,
  type ContinuityCapsule,
  type TokenCounter,
} from "./conversation-memory.js";

export type ChangeRequestCapsuleResult = {
  capsule: ContinuityCapsule;
  inputTokens: number;
  outputTokens: number;
  prompt: string;
  requestedTokens: number;
  tokenCountingStrategy: TokenCounter["strategy"];
  truncated: boolean;
};

export async function prepareChangeRequest(input: {
  conversationId: string;
  newRequest: string;
  storySummary: string;
  storyTitle: string;
  workspaceRoot: string;
  maximumTokens?: number;
  budget?: Partial<CapsuleBudget>;
  requestRef?: string;
  tokenCounter?: TokenCounter;
}) {
  const memory = new ConversationMemoryStore(
    input.workspaceRoot,
    input.conversationId,
    input.tokenCounter,
  );
  const result = await memory.beginRequest({
    currentRequest: input.newRequest,
    userGoal: storyGoal(input.storyTitle, input.storySummary),
    maximumTokens: input.maximumTokens,
    budget: input.budget,
    requestRef: input.requestRef,
  });
  return {
    ...result,
    prompt: renderContinuityPrompt(result.capsule, input.newRequest),
  } satisfies ChangeRequestCapsuleResult;
}

export async function changeRequestCapsule(input: {
  conversationId?: string;
  newRequest: string;
  storySummary: string;
  storyTitle: string;
  workspaceRoot: string;
  maximumTokens?: number;
  budget?: Partial<CapsuleBudget>;
  requestRef?: string;
  tokenCounter?: TokenCounter;
}) {
  const result = await prepareChangeRequest({
    ...input,
    conversationId:
      input.conversationId ?? `capsule:${input.storyTitle || "development"}`,
  });
  return result.prompt;
}

function storyGoal(title: string, summary: string) {
  return [title.trim(), summary.trim()].filter(Boolean).join("\n");
}
