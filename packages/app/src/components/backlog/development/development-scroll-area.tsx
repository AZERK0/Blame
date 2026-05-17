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
        "[scrollbar-color:color-mix(in_oklab,var(--muted-foreground)_35%,transparent)_transparent] [scrollbar-width:thin]",
        "[&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar]:w-2.5",
        "[&::-webkit-scrollbar-corner]:bg-background",
        "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
        "[&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/45",
        "[&::-webkit-scrollbar-track]:bg-transparent",
        className
      )}
    >
      {children}
    </div>
  )
}
