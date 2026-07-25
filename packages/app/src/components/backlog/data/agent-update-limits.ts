import type { UserStoryUpdate } from "./backlog-data.ts"

export const agentStoryTextLimit = 4096

export function boundedAgentMessage(value: string, fallback: string) {
  return (value || fallback).slice(0, agentStoryTextLimit)
}

export function boundedAgentUpdate(input: UserStoryUpdate): UserStoryUpdate {
  return {
    ...input,
    ...boundedTextField("agentLastError", input.agentLastError),
    ...boundedTextField("agentLastEvent", input.agentLastEvent),
  }
}

function boundedTextField(
  field: "agentLastError" | "agentLastEvent",
  value: string | null | undefined
) {
  if (value === undefined) return {}
  if (value === null) return { [field]: null }
  return { [field]: value.slice(0, agentStoryTextLimit) }
}
