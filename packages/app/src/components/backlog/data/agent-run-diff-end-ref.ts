import { captureAgentRunDiffEndRef } from "@/components/chat/agent-run-diffs"
import { afterRendererPaint } from "./agent-transition-scheduling.ts"
import type { useBacklogStore } from "./backlog-store.ts"
import type { UserStory, UserStoryAgentRun } from "./backlog-data.ts"
import type { Platform } from "@/context/platform"
import { measurePerformanceOperation } from "@/lib/performance-diagnostics"

export async function persistAgentRunDiffEndRef(
  story: UserStory,
  run: UserStoryAgentRun,
  platform: Platform,
  backlog: ReturnType<typeof useBacklogStore>
) {
  await afterRendererPaint()
  const diffEndRef = await measurePerformanceOperation(
    "agent.transition.diff_snapshot",
    () =>
      captureAgentRunDiffEndRef({
        id: run.id,
        platform,
        root: story.worktree,
      })
  )
  if (!diffEndRef) return
  await backlog.updateAgentRun(story, run, { diffEndRef })
}
