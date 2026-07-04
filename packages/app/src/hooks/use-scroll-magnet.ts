import * as React from "react"

const bottomMagnetRatio = 0.05
const scrollDirectionTolerance = 1

export function useScrollMagnet<T extends HTMLElement>(
  anchorRef: React.RefObject<T | null>,
  scrollKey: unknown,
  resetKey: unknown
) {
  const magnetActiveRef = React.useRef(true)
  const previousScrollTopRef = React.useRef(0)
  const frameRef = React.useRef(0)

  React.useEffect(() => () => cancelScrollFrame(frameRef), [])

  React.useEffect(() => {
    const viewport = scrollViewport(anchorRef.current)
    if (!viewport) return

    magnetActiveRef.current = true
    previousScrollTopRef.current = viewport.scrollTop
    scrollToBottom(viewport, frameRef)

    const handleScroll = () => {
      updateScrollMagnet(viewport, magnetActiveRef, previousScrollTopRef)
      if (magnetActiveRef.current) scrollToBottom(viewport, frameRef)
      else cancelScrollFrame(frameRef)
    }

    viewport.addEventListener("scroll", handleScroll, { passive: true })
    return () => viewport.removeEventListener("scroll", handleScroll)
  }, [anchorRef, resetKey])

  React.useEffect(() => {
    if (!magnetActiveRef.current) return
    const viewport = scrollViewport(anchorRef.current)
    if (viewport) scrollToBottom(viewport, frameRef)
  }, [anchorRef, scrollKey])
}

function updateScrollMagnet(
  viewport: HTMLElement,
  magnetActiveRef: React.RefObject<boolean>,
  previousScrollTopRef: React.RefObject<number>
) {
  const scrollTop = viewport.scrollTop
  const scrolledUp =
    scrollTop < previousScrollTopRef.current - scrollDirectionTolerance

  previousScrollTopRef.current = scrollTop
  if (scrolledUp) {
    magnetActiveRef.current = false
    return
  }
  if (nearScrollBottom(viewport)) magnetActiveRef.current = true
}

function nearScrollBottom(viewport: HTMLElement) {
  const maxScrollTop = viewport.scrollHeight - viewport.clientHeight
  if (maxScrollTop <= 0) return true
  return viewport.scrollTop >= maxScrollTop * (1 - bottomMagnetRatio)
}

function scrollToBottom(
  viewport: HTMLElement,
  frameRef: React.RefObject<number>
) {
  cancelScrollFrame(frameRef)
  frameRef.current = window.requestAnimationFrame(() => {
    viewport.scrollTop = viewport.scrollHeight
    frameRef.current = 0
  })
}

function cancelScrollFrame(frameRef: React.RefObject<number>) {
  if (!frameRef.current) return
  window.cancelAnimationFrame(frameRef.current)
  frameRef.current = 0
}

function scrollViewport(anchor: HTMLElement | null) {
  return anchor?.closest<HTMLElement>("[data-slot='scroll-area-viewport']")
}
