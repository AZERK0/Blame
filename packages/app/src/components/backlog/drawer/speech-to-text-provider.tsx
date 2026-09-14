import * as React from "react"
import { createPortal } from "react-dom"
import { MicIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SpeechRecordingControl } from "./speech-to-text-control"
import { createSpeechSessionStore } from "./speech-session-store"
import { useLatestCallback } from "@/lib/use-latest-callback"

const SpeechContext = React.createContext<ReturnType<
  typeof useSpeechSession
> | null>(null)

function useSpeechSession() {
  const [store] = React.useState(createSpeechSessionStore)
  const [activeKey, setActiveKey] = React.useState<string>()
  const [container] = React.useState(() => document.createElement("div"))
  return { store, activeKey, setActiveKey, container }
}

export function SpeechToTextProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const session = useSpeechSession()
  return (
    <SpeechContext.Provider value={session}>
      {children}
      <SpeechRecordingHost />
    </SpeechContext.Provider>
  )
}

function useSpeechContainer() {
  const session = React.useContext(SpeechContext)!
  const { store, activeKey, container } = session
  const fallback = React.useRef<HTMLDivElement>(null)
  const version = React.useSyncExternalStore(store.subscribe, store.snapshot)
  const slot = activeKey ? store.slot(activeKey) : undefined
  React.useLayoutEffect(() => {
    const target = slot?.visible ? slot.element : fallback.current
    target?.appendChild(container)
    return () => {
      container.remove()
    }
  }, [container, slot, version])
  return {
    ...session,
    fallback,
    floating: Boolean(activeKey && !slot?.visible),
  }
}

function SpeechRecordingHost() {
  const { store, activeKey, container, setActiveKey, fallback, floating } =
    useSpeechContainer()
  return (
    <>
      <div
        ref={fallback}
        role="region"
        aria-label="Voice input"
        className={
          floating
            ? "pointer-events-auto fixed right-4 bottom-4 z-[100] max-w-[calc(100vw-2rem)] rounded-2xl border bg-background p-3"
            : "hidden"
        }
      />
      {activeKey
        ? createPortal(
            <SpeechRecordingControl
              key={activeKey}
              onFinished={() => setActiveKey(undefined)}
              onTranscription={(text) => store.deliver(activeKey, text)}
            />,
            container
          )
        : null}
    </>
  )
}

type SpeechControlProps = {
  disabled?: boolean
  onStartRecording?: () => void
  onTranscription: (text: string) => void
  sessionKey?: string
}

export function SpeechToTextControl(properties: SpeechControlProps) {
  const session = React.useContext(SpeechContext)!
  const fallbackKey = React.useId()
  const key = properties.sessionKey ?? fallbackKey
  const slot = useSpeechSlot(key, properties.onTranscription)
  const startRecording = () => {
    properties.onStartRecording?.()
    session.setActiveKey(key)
  }
  return (
    <div ref={slot} className="flex min-h-8 min-w-8 items-center">
      {session.activeKey !== key ? (
        <SpeechStartButton
          disabled={properties.disabled || Boolean(session.activeKey)}
          onClick={startRecording}
        />
      ) : null}
    </div>
  )
}

function SpeechStartButton({
  disabled,
  onClick,
}: {
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Button
      aria-label="Start voice input"
      title="Start voice input"
      type="button"
      className="rounded-xl text-muted-foreground hover:text-foreground"
      size="icon-sm"
      variant="ghost"
      disabled={disabled}
      onPointerDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <MicIcon className="size-3.5" />
    </Button>
  )
}

function useSpeechSlot(key: string, onTranscription: (text: string) => void) {
  const { store } = React.useContext(SpeechContext)!
  const ref = React.useRef<HTMLDivElement>(null)
  const deliver = useLatestCallback(onTranscription)
  React.useEffect(() => {
    const element = ref.current
    if (!element) return
    const unregister = store.register(key, {
      element,
      onTranscription: deliver,
      visible: true,
    })
    const timer = window.setTimeout(() => store.flush(key), 0)
    const observer = new IntersectionObserver(([entry]) =>
      store.visibility(key, entry.isIntersecting)
    )
    observer.observe(element)
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
      unregister()
    }
  }, [deliver, key, store])
  return ref
}
