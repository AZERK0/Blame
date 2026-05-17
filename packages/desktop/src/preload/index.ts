import { contextBridge, ipcRenderer } from "electron"
import type { AgentEvent } from "@blame/agent-runtime"
import type { BlameDesktopApi } from "./types"

const api: BlameDesktopApi = {
  openDirectoryPicker: (options) => ipcRenderer.invoke("dialog:open-directory", options),
  openExternalLink: (url) => ipcRenderer.send("shell:open-external", url),
  workspace: {
    listDirectory: (input) => ipcRenderer.invoke("workspace:list-directory", input),
    readFile: (input) => ipcRenderer.invoke("workspace:read-file", input),
    searchFiles: (input) => ipcRenderer.invoke("workspace:search-files", input),
    gitDiff: (input) => ipcRenderer.invoke("workspace:git-diff", input),
  },
  agent: {
    providers: {
      list: (connection) => ipcRenderer.invoke("agent:providers:list", connection),
      saveCredential: (connection, input) =>
        ipcRenderer.invoke("agent:providers:save-credential", connection, input),
    },
    sessions: {
      start: (input) => ipcRenderer.invoke("agent:sessions:start", input),
      send: (input) => ipcRenderer.invoke("agent:sessions:send", input),
      abort: (sessionId) => ipcRenderer.invoke("agent:sessions:abort", sessionId),
      list: () => ipcRenderer.invoke("agent:sessions:list"),
      messages: (sessionId) => ipcRenderer.invoke("agent:sessions:messages", sessionId),
      onEvent: (sessionId, callback) => {
        const channel = `agent:sessions:event:${sessionId}`
        const handler = (_event: unknown, event: AgentEvent) => callback(event)
        ipcRenderer.on(channel, handler)
        return () => {
          ipcRenderer.removeListener(channel, handler)
          void ipcRenderer.invoke("agent:sessions:unsubscribe", sessionId)
        }
      },
    },
    approvals: {
      resolve: (input) => ipcRenderer.invoke("agent:approvals:resolve", input),
      onRequest: (callback) => {
        const handler = (_event: unknown, event: AgentEvent) => callback(event)
        ipcRenderer.on("agent:approvals:event", handler)
        return () => ipcRenderer.removeListener("agent:approvals:event", handler)
      },
    },
  },
}

contextBridge.exposeInMainWorld("blame", api)
