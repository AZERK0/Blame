import * as React from "react"

import { navigate } from "@/components/navigation/navigation"

function shouldHandleClick(event: React.MouseEvent<HTMLAnchorElement>) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    (!event.currentTarget.target || event.currentTarget.target === "_self")
  )
}

export function AppLink(props: React.ComponentProps<"a">) {
  return (
    <a
      {...props}
      onClick={(event) => {
        props.onClick?.(event)
        if (!shouldHandleClick(event)) return

        const href = event.currentTarget.getAttribute("href")
        if (href?.startsWith("/")) {
          event.preventDefault()
          navigate(href)
          return
        }

        const url = new URL(event.currentTarget.href)
        if (url.origin !== window.location.origin) return
        event.preventDefault()
        navigate(url.pathname)
      }}
    />
  )
}
