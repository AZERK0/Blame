import * as React from "react"

import {
  PlatformContext,
  createWebPlatform,
  type Platform,
} from "@/context/platform"

export function PlatformProvider({
  children,
  value,
}: {
  children: React.ReactNode
  value?: Platform
}) {
  return (
    <PlatformContext.Provider value={value ?? createWebPlatform()}>
      {children}
    </PlatformContext.Provider>
  )
}
