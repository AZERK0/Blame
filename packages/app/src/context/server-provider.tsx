import * as React from "react"

import { ServerContext } from "@/context/server"
import { usePlatform } from "@/context/platform"

export function ServerProvider({ children }: { children: React.ReactNode }) {
  const platform = usePlatform()

  return (
    <ServerContext.Provider value={{ available: Boolean(platform.agent) }}>
      {children}
    </ServerContext.Provider>
  )
}
