export type CodePracticeKey =
  | "coding_style"
  | "unit_tests"
  | "layered_architecture"
  | "commit_message_convention"

export type CodePractice = {
  id: number
  projectId: string
  practice: CodePracticeKey
  detected: boolean
  enabled: boolean
  comment: string
  createdAt: string
  updatedAt: string | null
}

export type CodePracticeUpdate = {
  enabled: boolean
}
