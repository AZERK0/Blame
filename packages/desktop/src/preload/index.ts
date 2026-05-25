import { contextBridge, ipcRenderer } from "electron";
import type { AgentEvent } from "@blame/agent-runtime";
import type { BlameDesktopApi } from "./types";

const api: BlameDesktopApi = {
  openDirectoryPicker: (options) =>
    ipcRenderer.invoke("dialog:open-directory", options),
  openExternalLink: (url) => ipcRenderer.send("shell:open-external", url),
  openPath: (path) => ipcRenderer.invoke("shell:open-path", path),
  workspace: {
    listDirectory: (input) =>
      ipcRenderer.invoke("workspace:list-directory", input),
    readFile: (input) => ipcRenderer.invoke("workspace:read-file", input),
    searchFiles: (input) => ipcRenderer.invoke("workspace:search-files", input),
    gitDiff: (input) => ipcRenderer.invoke("workspace:git-diff", input),
    gitRepositoryFingerprint: (input) =>
      ipcRenderer.invoke("workspace:git-repository-fingerprint", input),
    createWorktree: (input) =>
      ipcRenderer.invoke("workspace:create-worktree", input),
    runProjectSetup: (input) =>
      ipcRenderer.invoke("workspace:run-project-setup", input),
    stopProjectSetup: (input) =>
      ipcRenderer.invoke("workspace:stop-project-setup", input),
    removeWorktree: (input) =>
      ipcRenderer.invoke("workspace:remove-worktree", input),
    resolveProjectPreviewUrl: (input) =>
      ipcRenderer.invoke("workspace:resolve-project-preview-url", input),
    ensureProjectPreviewUrl: (input) =>
      ipcRenderer.invoke("workspace:ensure-project-preview-url", input),
    onSetupEvent: (runId, callback) => {
      const channel = `workspace:setup:event:${runId}`;
      const handler = (
        _event: unknown,
        event: Parameters<typeof callback>[0],
      ) => callback(event);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
  },
  terminal: {
    start: (input) => ipcRenderer.invoke("terminal:start", input),
    write: (input) => ipcRenderer.invoke("terminal:write", input),
    stop: (id) => ipcRenderer.invoke("terminal:stop", id),
    onEvent: (id, callback) => {
      const channel = `terminal:event:${id}`;
      const handler = (
        _event: unknown,
        event: Parameters<typeof callback>[0],
      ) => callback(event);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
  },
  agent: {
    providers: {
      list: (connection) =>
        ipcRenderer.invoke("agent:providers:list", connection),
      saveCredential: (connection, input) =>
        ipcRenderer.invoke(
          "agent:providers:save-credential",
          connection,
          input,
        ),
      deleteCredential: (connection, id) =>
        ipcRenderer.invoke("agent:providers:delete-credential", connection, id),
      loginOAuth: (input) =>
        ipcRenderer.invoke("agent:providers:login-oauth", input),
    },
    sessions: {
      start: (input) => ipcRenderer.invoke("agent:sessions:start", input),
      send: (input) => ipcRenderer.invoke("agent:sessions:send", input),
      abort: (sessionId) =>
        ipcRenderer.invoke("agent:sessions:abort", sessionId),
      list: () => ipcRenderer.invoke("agent:sessions:list"),
      messages: (sessionId) =>
        ipcRenderer.invoke("agent:sessions:messages", sessionId),
      onEvent: (sessionId, callback) => {
        const channel = `agent:sessions:event:${sessionId}`;
        const handler = (_event: unknown, event: AgentEvent) => callback(event);
        ipcRenderer.on(channel, handler);
        return () => {
          ipcRenderer.removeListener(channel, handler);
          void ipcRenderer.invoke("agent:sessions:unsubscribe", sessionId);
        };
      },
    },
    approvals: {
      resolve: (input) => ipcRenderer.invoke("agent:approvals:resolve", input),
      onRequest: (callback) => {
        const handler = (_event: unknown, event: AgentEvent) => callback(event);
        ipcRenderer.on("agent:approvals:event", handler);
        return () =>
          ipcRenderer.removeListener("agent:approvals:event", handler);
      },
    },
    initializations: {
      run: (input) => ipcRenderer.invoke("agent:initializations:run", input),
    },
  },
};

contextBridge.exposeInMainWorld("blame", api);
