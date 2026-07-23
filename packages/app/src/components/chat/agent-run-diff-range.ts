export type AgentRunDiffBoundary = {
  checkpointRunCount: number
  sessionId: string
}

export function loadAgentRunPatch({
  compareCheckpoint,
  diffBetween,
  from,
  toRef,
}: {
  compareCheckpoint: (boundary: AgentRunDiffBoundary) => Promise<string>
  diffBetween: (from: string, to: string) => Promise<string>
  from: AgentRunDiffBoundary
  toRef: string
}) {
  return compareCheckpoint(from).then((fromRef) => diffBetween(fromRef, toRef))
}
