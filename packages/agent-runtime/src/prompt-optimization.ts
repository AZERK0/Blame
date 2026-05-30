import type { ClineCore } from "@cline/sdk"

import { loadPrompt } from "./prompt-loader.js"
import { appendProductionConfig } from "./production.js"
import type {
  OptimizeUserStoryPromptInput,
  OptimizeUserStoryPromptResult,
} from "./types.js"

type PromptOptimizationCredential = {
  apiKey: string
  baseUrl: string | null
}

export async function optimizeUserStoryPrompt(
  input: OptimizeUserStoryPromptInput,
  cline: ClineCore,
  credential: PromptOptimizationCredential
): Promise<OptimizeUserStoryPromptResult> {
  const prompt = promptOptimizationUserPrompt(input)
  const session = await cline.start({
    prompt,
    config: promptOptimizationConfig(input, credential),
    interactive: false,
    source: "blame-prompt-optimizer",
  })
  const markdown = optimizedMarkdown(session.result?.text)
  if (!markdown) throw new Error("Prompt optimizer agent did not return Markdown.")
  return { sessionId: session.sessionId, markdown }
}

function promptOptimizationConfig(
  input: OptimizeUserStoryPromptInput,
  credential: PromptOptimizationCredential
) {
  return appendProductionConfig({
    providerId: input.providerId,
    modelId: input.modelId,
    apiKey: credential.apiKey,
    baseUrl: credential.baseUrl ?? undefined,
    thinking: !!input.reasoningEffort,
    reasoningEffort: input.reasoningEffort,
    systemPrompt: loadPrompt("prompt-optimizer-agent-system"),
    cwd: input.cwd,
    workspaceRoot: input.workspaceRoot,
    enableTools: false,
    enableSpawnAgent: false,
    enableAgentTeams: false,
    maxIterations: 4,
  })
}

function promptOptimizationUserPrompt(input: OptimizeUserStoryPromptInput) {
  return [
    "Optimize this rough user story prompt.",
    "",
    optionalTitle(input.title),
    "User prompt:",
    input.prompt.trim(),
  ]
    .filter(Boolean)
    .join("\n")
}

function optionalTitle(title: string | undefined) {
  const value = title?.trim()
  return value ? `Current title: ${value}\n` : ""
}

function optimizedMarkdown(value: unknown) {
  const markdown = stringValue(value)?.trim()
  if (!markdown) return undefined
  return markdown
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}
