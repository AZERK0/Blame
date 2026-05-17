import * as React from "react"

import type { ServerConnection } from "@/context/platform"

export type ServerContextValue = {
  server?: ServerConnection
}

export const ServerContext = React.createContext<ServerContextValue>({})

export function useServer() {
  return React.useContext(ServerContext)
}
