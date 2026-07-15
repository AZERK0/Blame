import type { GenerateTitleInput } from "@blame/agent-runtime"

import type { Platform } from "@/context/platform"

type TitleGenerator = NonNullable<
  Platform["agent"]
>["promptOptimizer"]["generateTitle"]

export type AgentTitleGenerationInput = Omit<
  GenerateTitleInput,
  "cwd" | "workspaceRoot"
> & {
  workspace: string
}

export async function generateAgentTitle(
  generateTitle: TitleGenerator,
  input: AgentTitleGenerationInput
) {
  return (await generateAgentTitleSelection(generateTitle, input)).title
}

export async function generateAgentTitleSelection(
  generateTitle: TitleGenerator,
  input: AgentTitleGenerationInput
) {
  const result = await generateTitle({
    ...input,
    cwd: input.workspace,
    workspaceRoot: input.workspace,
  })
  const title = normalizedAgentTitle(result.title)
  if (!title) throw new Error("Title generator agent did not return a title.")
  return { title, runConfigurationId: result.runConfigurationId }
}

export function normalizedAgentTitle(title: string) {
  return title
    .trim()
    .replace(/[.!?:;]+$/g, "")
    .split(/\s+/)
    .slice(0, 6)
    .join(" ")
}
