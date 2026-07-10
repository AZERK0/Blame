const backlogStorySelectionEvent = "backlog:story-selection"

let selectedStoryId: string | undefined

export function selectBacklogStory(storyId: string | undefined) {
  selectedStoryId = storyId
  window.dispatchEvent(new Event(backlogStorySelectionEvent))
}

export function selectedBacklogStoryId() {
  return selectedStoryId
}

export function subscribeToBacklogStorySelection(callback: () => void) {
  window.addEventListener(backlogStorySelectionEvent, callback)
  return () => window.removeEventListener(backlogStorySelectionEvent, callback)
}
