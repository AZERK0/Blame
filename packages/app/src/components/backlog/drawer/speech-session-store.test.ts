import assert from "node:assert/strict"
import test from "node:test"
import {
  createSpeechSessionStore,
  type SpeechSlot,
} from "./speech-session-store.ts"

function slot(onTranscription: (text: string) => void): SpeechSlot {
  return { element: {} as HTMLElement, onTranscription, visible: true }
}

test("dictation completed away from its editor returns only to the original editor", () => {
  const store = createSpeechSessionStore()
  const original: string[] = []
  const other: string[] = []
  const leave = store.register(
    "chat:first",
    slot((text) => original.push(text))
  )
  leave()
  store.register(
    "chat:second",
    slot((text) => other.push(text))
  )
  store.deliver("chat:first", "Fix the layout")
  assert.deepEqual(other, [])
  store.register(
    "chat:first",
    slot((text) => original.push(text))
  )
  store.flush("chat:first")
  store.flush("chat:first")
  assert.deepEqual(original, ["Fix the layout"])
})

test("returning to an editor reattaches its slot without losing a live dictation", () => {
  const store = createSpeechSessionStore()
  const texts: string[] = []
  const leave = store.register(
    "story",
    slot(() => assert.fail("stale editor"))
  )
  store.visibility("story", false)
  assert.equal(store.slot("story")?.visible, false)
  leave()
  assert.equal(store.slot("story"), undefined)
  const replacement = slot((text) => texts.push(text))
  store.register("story", replacement)
  leave()
  assert.equal(store.slot("story"), replacement)
  store.deliver("story", "Keep recording")
  assert.deepEqual(texts, ["Keep recording"])
})

test("multiple completed dictations are restored together after draft hydration", () => {
  const store = createSpeechSessionStore()
  store.deliver("story", "First sentence.")
  store.deliver("story", "Second sentence.")
  const texts: string[] = []
  store.register(
    "story",
    slot((text) => texts.push(text))
  )
  assert.deepEqual(texts, [])
  store.flush("story")
  assert.deepEqual(texts, ["First sentence. Second sentence."])
})
