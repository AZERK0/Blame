import { normalize, resolve } from "node:path"

export class WorkspaceWriterRegistry {
  private readonly activeSessions = new Set<string>()
  private readonly sessionWorkspaces = new Map<string, string>()

  begin(sessionId: string, workspace: string) {
    this.sessionWorkspaces.set(sessionId, canonicalWorkspace(workspace))
    this.activeSessions.add(sessionId)
  }

  rebind(previousSessionId: string, sessionId: string) {
    const workspace = this.sessionWorkspaces.get(previousSessionId)
    const active = this.activeSessions.has(previousSessionId)
    this.sessionWorkspaces.delete(previousSessionId)
    this.activeSessions.delete(previousSessionId)
    if (!workspace) return
    this.sessionWorkspaces.set(sessionId, workspace)
    if (active) this.activeSessions.add(sessionId)
  }

  end(sessionId: string) {
    this.activeSessions.delete(sessionId)
  }

  forget(sessionId: string) {
    this.activeSessions.delete(sessionId)
    this.sessionWorkspaces.delete(sessionId)
  }

  workspaceForSession(sessionId: string) {
    return this.sessionWorkspaces.get(sessionId)
  }

  hasActiveWriter(workspace: string) {
    const canonical = canonicalWorkspace(workspace)
    return [...this.activeSessions].some(
      (sessionId) => this.sessionWorkspaces.get(sessionId) === canonical,
    )
  }

  releaseWorkspace(workspace: string) {
    const canonical = canonicalWorkspace(workspace)
    for (const [sessionId, candidate] of this.sessionWorkspaces) {
      if (candidate !== canonical) continue
      this.activeSessions.delete(sessionId)
      this.sessionWorkspaces.delete(sessionId)
    }
  }

  clear() {
    this.activeSessions.clear()
    this.sessionWorkspaces.clear()
  }
}

function canonicalWorkspace(value: string) {
  const path = normalize(resolve(value))
  return process.platform === "win32" ? path.toLowerCase() : path
}
