import * as React from "react"
import { ArrowDownIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const bottomThreshold = 24

type MessageScrollerContextValue = {
  atBottom: boolean
  followingRef: React.RefObject<boolean>
  scrollToLatest: () => void
  setAtBottom: React.Dispatch<React.SetStateAction<boolean>>
  viewportRef: React.RefObject<HTMLDivElement | null>
}

const MessageScrollerContext =
  React.createContext<MessageScrollerContextValue | null>(null)

function MessageScrollerProvider({ children }: { children: React.ReactNode }) {
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const followingRef = React.useRef(true)
  const [atBottom, setAtBottom] = React.useState(true)

  const scrollToLatest = React.useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    followingRef.current = true
    viewport.scrollTop = viewport.scrollHeight
    const distance =
      viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
    setAtBottom(distance <= bottomThreshold)
  }, [])

  const value = React.useMemo(
    () => ({
      atBottom,
      followingRef,
      scrollToLatest,
      setAtBottom,
      viewportRef,
    }),
    [atBottom, scrollToLatest]
  )

  return (
    <MessageScrollerContext.Provider value={value}>
      {children}
    </MessageScrollerContext.Provider>
  )
}

function MessageScroller({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-scroller"
      className={cn("relative flex min-h-0 flex-1 flex-col", className)}
      {...props}
    />
  )
}

function MessageScrollerViewport({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { followingRef, setAtBottom, viewportRef } = useMessageScroller()

  React.useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const updatePosition = () => {
      const distance =
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
      const atBottom = distance <= bottomThreshold
      setAtBottom(atBottom)
    }
    const handleScroll = () => {
      const distance =
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
      const atBottom = distance <= bottomThreshold
      followingRef.current = atBottom
      setAtBottom(atBottom)
    }
    const followLatest = () => {
      if (!followingRef.current) {
        updatePosition()
        return
      }
      viewport.scrollTop = viewport.scrollHeight
      setAtBottom(true)
    }

    const resizeObserver = new ResizeObserver(followLatest)
    const mutationObserver = new MutationObserver(followLatest)
    resizeObserver.observe(viewport)
    if (viewport.firstElementChild)
      resizeObserver.observe(viewport.firstElementChild)
    mutationObserver.observe(viewport, { childList: true, subtree: true })
    viewport.addEventListener("scroll", handleScroll, { passive: true })
    followLatest()

    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      viewport.removeEventListener("scroll", handleScroll)
    }
  }, [followingRef, setAtBottom, viewportRef])

  return (
    <div
      ref={viewportRef}
      data-slot="message-scroller-viewport"
      role="region"
      aria-label="Messages"
      tabIndex={0}
      className={cn(
        "min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-scroller-content"
      role="log"
      aria-relevant="additions"
      className={cn("flex min-h-full flex-col", className)}
      {...props}
    />
  )
}

function MessageScrollerButton({
  className,
  style,
}: {
  className?: string
  style?: React.CSSProperties
}) {
  const { atBottom, scrollToLatest } = useMessageScroller()

  return (
    <Button
      aria-label="Jump to latest message"
      className={cn(
        "absolute right-4 bottom-4 z-10 size-9 rounded-full shadow-lg transition-all",
        atBottom && "pointer-events-none translate-y-2 opacity-0",
        className
      )}
      inert={atBottom ? true : undefined}
      onClick={scrollToLatest}
      size="icon-sm"
      style={style}
      tabIndex={atBottom ? -1 : 0}
      type="button"
      variant="outline"
    >
      <ArrowDownIcon className="size-4" />
    </Button>
  )
}

function useMessageScroller() {
  const context = React.useContext(MessageScrollerContext)
  if (!context) {
    throw new Error(
      "MessageScroller must be used inside MessageScrollerProvider"
    )
  }
  return context
}

export {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
}
