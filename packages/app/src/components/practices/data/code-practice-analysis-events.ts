const updatedEvent = "code-practice-analysis:updated"

export function notifyCodePracticeAnalysisUpdated(projectId: string) {
  window.dispatchEvent(new CustomEvent(updatedEvent, { detail: projectId }))
}

export function subscribeCodePracticeAnalysisUpdated(
  projectId: string,
  callback: () => void
) {
  const handleUpdate = (event: Event) => {
    if ((event as CustomEvent<string>).detail === projectId) callback()
  }
  window.addEventListener(updatedEvent, handleUpdate)
  return () => window.removeEventListener(updatedEvent, handleUpdate)
}
