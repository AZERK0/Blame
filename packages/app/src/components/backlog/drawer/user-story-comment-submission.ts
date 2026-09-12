import type { UserStory, UserStoryComment } from "../data/backlog-data.ts"

type CommentInput = Pick<
  UserStoryComment,
  "body" | "codeSelectionAttachments" | "fileAttachments"
>

type Submission = {
  story: UserStory
  input: CommentInput
  createComment: (input: CommentInput) => Promise<UserStoryComment>
  requestChanges: (comment: UserStoryComment) => Promise<UserStory>
}

export function createUserStoryCommentSubmission() {
  let pending = false
  let saved:
    | { storyId: string; key: string; comment: UserStoryComment }
    | undefined

  return {
    get pending() {
      return pending
    },
    async submit({ story, input, createComment, requestChanges }: Submission) {
      if (pending) return false
      pending = true
      try {
        const key = commentKey(input)
        const previous =
          saved?.storyId === story.id && saved.key === key
            ? saved.comment
            : undefined
        const comment =
          previous ??
          recoverableComment(story, key) ??
          (await createComment(input))
        saved = { storyId: story.id, key, comment }
        if (story.status === "in-review") {
          const nextStory = await requestChanges(comment)
          if (nextStory.status !== "in-progress") return false
        }
        saved = undefined
        return true
      } finally {
        pending = false
      }
    },
  }
}

function recoverableComment(story: UserStory, key: string) {
  if (story.status !== "in-review") return undefined
  const runs = story.agentRuns ?? []
  const latestRunCreatedAt = Math.max(
    0,
    ...runs.map((run) => Date.parse(run.createdAt))
  )
  return [...(story.comments ?? [])]
    .reverse()
    .find(
      (comment) =>
        Date.parse(comment.createdAt) >= latestRunCreatedAt &&
        !runs.some((run) => run.commentId === comment.id) &&
        commentKey(comment) === key
    )
}

function commentKey(input: CommentInput) {
  return JSON.stringify({
    body: input.body,
    code: (input.codeSelectionAttachments ?? []).map((attachment) => ({
      id: attachment.id,
      content: attachment.content,
      path: attachment.path,
      startLine: attachment.startLine,
      endLine: attachment.endLine,
    })),
    files: (input.fileAttachments ?? []).map((attachment) => attachment.id),
  })
}
