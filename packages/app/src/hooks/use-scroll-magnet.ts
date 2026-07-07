import * as React from "react"

const bottomMagnetRatio = 0.05
const scrollDirectionTolerance = 1
const touchMoveTolerance = 1

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
    let touchY: number | undefined

    const handleScroll = () => {
      updateScrollMagnet(viewport, magnetActiveRef, previousScrollTopRef)
      if (magnetActiveRef.current) scrollToBottom(viewport, frameRef)
      else cancelScrollFrame(frameRef)
    }
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) releaseScrollMagnet(magnetActiveRef, frameRef)
      if (event.deltaY > 0 && nearScrollBottom(viewport))
        magnetActiveRef.current = true
    }
    const handleTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY
    }
    const handleTouchMove = (event: TouchEvent) => {
      const nextTouchY = event.touches[0]?.clientY
      if (touchY !== undefined && nextTouchY !== undefined) {
        if (nextTouchY > touchY + touchMoveTolerance)
          releaseScrollMagnet(magnetActiveRef, frameRef)
        if (
          nextTouchY < touchY - touchMoveTolerance &&
          nearScrollBottom(viewport)
        )
          magnetActiveRef.current = true
      }
      touchY = nextTouchY
    }

    viewport.addEventListener("wheel", handleWheel, { passive: true })
    viewport.addEventListener("scroll", handleScroll, { passive: true })
    viewport.addEventListener("touchstart", handleTouchStart, { passive: true })
    viewport.addEventListener("touchmove", handleTouchMove, { passive: true })
    return () => {
      viewport.removeEventListener("wheel", handleWheel)
      viewport.removeEventListener("scroll", handleScroll)
      viewport.removeEventListener("touchstart", handleTouchStart)
      viewport.removeEventListener("touchmove", handleTouchMove)
    }
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
  const scrolledDown =
    scrollTop > previousScrollTopRef.current + scrollDirectionTolerance

  previousScrollTopRef.current = scrollTop
  if (scrolledUp) {
    magnetActiveRef.current = false
    return
  }
  if (scrolledDown && nearScrollBottom(viewport)) magnetActiveRef.current = true
}

function releaseScrollMagnet(
  magnetActiveRef: React.RefObject<boolean>,
  frameRef: React.RefObject<number>
) {
  magnetActiveRef.current = false
  cancelScrollFrame(frameRef)
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
