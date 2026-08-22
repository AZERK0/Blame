import { changedFilesFromDiff } from "../../components/backlog/data/user-story-context.ts"

type ReviewStory = {
  baseCommit?: string | null
  worktree?: string | null
}

type ReviewWorkspace = {
  gitDiffFrom(input: { from: string; root: string }): Promise<string>
}

export async function currentReviewDiffEmpty(
  story: ReviewStory,
  workspace: ReviewWorkspace | null | undefined
) {
  if (!story.worktree || !story.baseCommit || !workspace) return false
  try {
    const diff = await workspace.gitDiffFrom({
      from: story.baseCommit,
      root: story.worktree,
    })
    return changedFilesFromDiff(diff).length === 0
  } catch {
    return false
  }
}
