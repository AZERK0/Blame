export type SpeechSlot = {
  element: HTMLElement
  onTranscription: (text: string) => void
  visible: boolean
}

class SpeechSessionStore {
  private slots = new Map<string, SpeechSlot>()
  private pending = new Map<string, string[]>()
  private listeners = new Set<() => void>()
  private version = 0

  snapshot = () => this.version

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  slot(key: string) {
    return this.slots.get(key)
  }

  register(key: string, slot: SpeechSlot) {
    this.slots.set(key, slot)
    this.notify()
    return () => {
      if (this.slots.get(key) !== slot) return
      this.slots.delete(key)
      this.notify()
    }
  }

  flush(key: string) {
    const slot = this.slots.get(key)
    const texts = this.pending.get(key)
    if (!slot || !texts?.length) return
    this.pending.delete(key)
    slot.onTranscription(texts.join(" "))
  }

  visibility(key: string, visible: boolean) {
    const slot = this.slots.get(key)
    if (!slot || slot.visible === visible) return
    slot.visible = visible
    this.notify()
  }

  deliver(key: string, text: string) {
    const slot = this.slots.get(key)
    if (slot) slot.onTranscription(text)
    else this.pending.set(key, [...(this.pending.get(key) ?? []), text])
  }

  private notify() {
    this.version += 1
    this.listeners.forEach((listener) => listener())
  }
}

export function createSpeechSessionStore() {
  return new SpeechSessionStore()
}
