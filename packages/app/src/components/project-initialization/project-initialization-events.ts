const projectInitializationUpdatedEvent = "project-initialization:updated"

export function notifyProjectInitializationUpdated(projectId: string) {
  window.dispatchEvent(
    new CustomEvent(projectInitializationUpdatedEvent, { detail: projectId })
  )
}

export function subscribeProjectInitializationUpdated(
  projectId: string,
  callback: () => void
) {
  const handleUpdate = (event: Event) => {
    if ((event as CustomEvent<string>).detail === projectId) callback()
  }
  window.addEventListener(projectInitializationUpdatedEvent, handleUpdate)
  return () =>
    window.removeEventListener(projectInitializationUpdatedEvent, handleUpdate)
}
