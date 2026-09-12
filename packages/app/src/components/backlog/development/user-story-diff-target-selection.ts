export type UserStoryDiffTarget =
  | {
      id: string
      mode: "working"
      refresh: boolean
      root: string
      baseCommit?: string | null
      repositoryRoot?: string
    }
  | {
      from: string
      id: string
      mode: "historical"
      root: string
      to: string
    }

export function initialUserStoryDiffTargets(
  targets: UserStoryDiffTarget[],
  loadedTargetKeys: Set<string>
) {
  return targets.filter(
    (target) =>
      refreshableDiffTarget(target) &&
      (target.mode === "working" ||
        !loadedTargetKeys.has(userStoryDiffTargetKey(target)))
  )
}

export function suspendedUserStoryDiffTargetCount(
  targets: UserStoryDiffTarget[]
) {
  return targets.filter(
    (target) => target.mode === "working" && !target.refresh
  ).length
}

export function userStoryDiffTargetKey(target: UserStoryDiffTarget) {
  if (target.mode === "working")
    return [
      target.mode,
      target.id,
      target.root,
      target.baseCommit,
      target.repositoryRoot,
    ].join(":")
  return [target.mode, target.id, target.root, target.from, target.to].join(":")
}

function refreshableDiffTarget(target: UserStoryDiffTarget) {
  return target.mode === "historical" || target.refresh
}
