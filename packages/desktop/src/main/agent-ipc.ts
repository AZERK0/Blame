import { BlameAgentRuntime, type AgentEvent } from "@blame/agent-runtime"
import { BrowserWindow, ipcMain, shell } from "electron"

const runtime = new BlameAgentRuntime({
  emit(event) {
    emitAgentEvent(event)
  },
}, {
  openExternalUrl(url) {
    void shell.openExternal(url)
  },
})

export function registerAgentIpcHandlers() {
  ipcMain.handle("agent:providers:list", (_event, connection) => runtime.providers.list(connection))
  ipcMain.handle("agent:providers:save-credential", (_event, connection, input) =>
    runtime.providers.saveCredential(connection, input)
  )
  ipcMain.handle("agent:providers:delete-credential", (_event, connection, id) =>
    runtime.providers.deleteCredential(connection, id)
  )
  ipcMain.handle("agent:providers:login-oauth", (_event, input) => runtime.providers.loginOAuth(input))
  ipcMain.handle("agent:sessions:start", (_event, input) => runtime.sessions.start(input))
  ipcMain.handle("agent:sessions:send", (_event, input) => runtime.sessions.send(input))
  ipcMain.handle("agent:sessions:abort", (_event, sessionId) => runtime.sessions.abort(sessionId))
  ipcMain.handle("agent:sessions:list", () => runtime.sessions.list())
  ipcMain.handle("agent:sessions:messages", (_event, sessionId) => runtime.sessions.messages(sessionId))
  ipcMain.handle("agent:sessions:unsubscribe", (_event, sessionId) => runtime.sessions.unsubscribe(sessionId))
  ipcMain.handle("agent:approvals:resolve", (_event, input) => runtime.approvals.resolve(input))
}

function emitAgentEvent(event: AgentEvent) {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (event.sessionId) window.webContents.send(`agent:sessions:event:${event.sessionId}`, event)
    if (event.type === "approval") window.webContents.send("agent:approvals:event", event)
  })
}
