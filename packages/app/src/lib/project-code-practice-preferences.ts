import type { ProjectCodePracticeKey } from "@blame/agent-runtime"

type ProjectCodePracticePreference = {
  practice: ProjectCodePracticeKey
  enabled: boolean
}

export function effectiveProjectCodePractices(
  practices: ProjectCodePracticePreference[]
) {
  return defaultProjectCodePractices.map((fallback) => {
    const stored = practices.find(
      ({ practice }) => practice === fallback.practice
    )
    return stored ?? fallback
  })
}

const defaultProjectCodePractices: ProjectCodePracticePreference[] = [
  { practice: "coding_style", enabled: true },
  { practice: "unit_tests", enabled: false },
  { practice: "layered_architecture", enabled: false },
  { practice: "commit_message_convention", enabled: false },
]
