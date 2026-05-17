import * as React from "react"

export type ServerContextValue = {
  available: boolean
}

export const ServerContext = React.createContext<ServerContextValue>({
  available: false,
})

export function useServer() {
  return React.useContext(ServerContext)
}
