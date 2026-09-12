import { changedFilesFromDiff } from "../../components/backlog/data/user-story-context.ts"
import { storyDiffBase } from "../../components/backlog/development/story-working-diff.ts"

type ReviewStory = {
  baseCommit?: string | null
  worktree?: string | null
}

type ReviewWorkspace = {
  gitDiffFrom(input: { from: string; root: string }): Promise<string>
  gitLog?(input: {
    root: string
    limit: number
    currentBranchOnly?: boolean
  }): Promise<{ hash: string }[]>
}

export async function currentReviewDiffEmpty(
  story: ReviewStory,
  workspace: ReviewWorkspace | null | undefined,
  repositoryRoot?: string
) {
  if (!story.worktree || !workspace) return false
  try {
    const from = await storyDiffBase(
      { root: story.worktree, baseCommit: story.baseCommit, repositoryRoot },
      workspace
    )
    if (!from) return false
    const diff = await workspace.gitDiffFrom({
      from,
      root: story.worktree,
    })
    return changedFilesFromDiff(diff).length === 0
  } catch {
    return false
  }
}
