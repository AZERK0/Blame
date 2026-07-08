import type { ProjectRunConfiguration } from "@blame/agent-runtime"

export function storyPreviewDevtoolsScope(storyId: string) {
  return `story:${storyId}`
}

export function runnerPreviewDevtoolsScope(
  configuration?: ProjectRunConfiguration,
  projectPath = "project"
) {
  return `runner:${projectPath}:${configuration?.id ?? "preview"}`
}
