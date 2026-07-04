import * as React from "react"

import { cn } from "@/lib/utils"

export function DevelopmentScrollArea({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "min-h-0 min-w-0 max-w-full overflow-auto",
        className
      )}
    >
      {children}
    </div>
  )
}
