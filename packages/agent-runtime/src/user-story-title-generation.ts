import type { ClineCore } from "@cline/sdk";

import { loadPrompt } from "./prompt-loader.js";
import { appendProductionConfig } from "./production.js";
import type {
  GenerateUserStoryTitleInput,
  GenerateUserStoryTitleResult,
} from "./types.js";

type TitleGenerationCredential = {
  apiKey: string;
  baseUrl: string | null;
};

export async function generateUserStoryTitle(
  input: GenerateUserStoryTitleInput,
  cline: ClineCore,
  credential: TitleGenerationCredential,
): Promise<GenerateUserStoryTitleResult> {
  const session = await cline.start({
    prompt: titleGenerationUserPrompt(input),
    config: titleGenerationConfig(input, credential),
    interactive: false,
    source: "blame-user-story-title-generator",
  });
  const title = generatedTitle(session.result?.text);
  if (!title) throw new Error("Title generator agent did not return a title.");
  return { sessionId: session.sessionId, title };
}

function titleGenerationConfig(
  input: GenerateUserStoryTitleInput,
  credential: TitleGenerationCredential,
) {
  return appendProductionConfig({
    providerId: input.providerId,
    modelId: input.modelId,
    apiKey: credential.apiKey,
    baseUrl: credential.baseUrl ?? undefined,
    thinking: !!input.reasoningEffort,
    reasoningEffort: input.reasoningEffort,
    systemPrompt: loadPrompt("user-story-title-generator-system"),
    cwd: input.cwd,
    workspaceRoot: input.workspaceRoot,
    enableTools: false,
    enableSpawnAgent: false,
    enableAgentTeams: false,
    maxIterations: 2,
  });
}

function titleGenerationUserPrompt(input: GenerateUserStoryTitleInput) {
  return ["User story content:", input.prompt.trim()].join("\n");
}

function generatedTitle(value: unknown) {
  const candidate = titleCandidate(value);
  if (!candidate) return undefined;
  return candidate.split(/\s+/).slice(0, 6).join(" ");
}

function titleCandidate(value: unknown) {
  return stringValue(value)
    ?.trim()
    .replace(/^```(?:text|markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^#+\s*/, "")
        .replace(/^[-*]\s*/, "")
        .replace(/^["'`]+|["'`]+$/g, "")
        .replace(/[.!?:;]+$/g, "")
        .trim(),
    )
    .find(Boolean);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
