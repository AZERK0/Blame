export type StoryWorkingDiffInput = {
  root: string
  baseCommit?: string | null
  repositoryRoot?: string
}

type StoryDiffWorkspace = {
  gitDiff(input: { root: string }): Promise<string>
  gitDiffFrom(input: { from: string; root: string }): Promise<string>
  gitLog?(input: {
    root: string
    limit: number
    currentBranchOnly?: boolean
  }): Promise<{ hash: string }[]>
}

export async function storyDiffBase(
  input: StoryWorkingDiffInput,
  workspace: Pick<StoryDiffWorkspace, "gitLog">
) {
  if (input.baseCommit) return input.baseCommit
  if (!input.repositoryRoot || input.repositoryRoot === input.root) return
  // Older stories did not save their starting commit. Compare them with the
  // active project branch, never with the already-committed story HEAD.
  const commits = await workspace.gitLog?.({
    root: input.repositoryRoot,
    limit: 1,
    currentBranchOnly: true,
  })
  return commits?.[0]?.hash
}

export async function storyWorkingDiff(
  input: StoryWorkingDiffInput,
  workspace: StoryDiffWorkspace
) {
  const from = await storyDiffBase(input, workspace)
  if (!from && input.repositoryRoot && input.repositoryRoot !== input.root) {
    throw new Error("Unable to resolve the project branch for review.")
  }
  return from
    ? workspace.gitDiffFrom({ from, root: input.root })
    : workspace.gitDiff({ root: input.root })
}
