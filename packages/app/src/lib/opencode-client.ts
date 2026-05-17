import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

import type { ServerConnection } from "@/context/platform"

export function createSdkForServer(server: ServerConnection) {
  const auth = server.password
    ? {
        Authorization: `Basic ${btoa(`${server.username ?? "opencode"}:${server.password}`)}`,
      }
    : undefined

  return createOpencodeClient({
    baseUrl: server.url,
    headers: auth,
  })
}
