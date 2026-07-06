import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function UserStoryTitleCloud({
  active,
  children,
  className,
}: {
  active?: boolean
  children: ReactNode
  className?: string
}) {
  if (active) {
    return (
      <span
        className={cn(
          "user-story-title-cloud user-story-title-cloud-active",
          className
        )}
      >
        <span className="user-story-title-cloud-placeholder">{children}</span>
        <span aria-hidden="true" className="magic-cloud" />
      </span>
    )
  }

  return (
    <span className={cn("user-story-title-cloud", className)}>{children}</span>
  )
}
