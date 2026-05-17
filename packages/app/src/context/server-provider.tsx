import * as React from "react"

import { ServerContext } from "@/context/server"
import { usePlatform, type ServerConnection } from "@/context/platform"

export function ServerProvider({ children }: { children: React.ReactNode }) {
  const platform = usePlatform()
  const [server, setServer] = React.useState<ServerConnection>()

  React.useEffect(() => {
    let alive = true
    void platform.getServer?.().then((next) => {
      if (alive) setServer(next)
    })
    return () => {
      alive = false
    }
  }, [platform])

  return (
    <ServerContext.Provider value={{ server }}>
      {children}
    </ServerContext.Provider>
  )
}
