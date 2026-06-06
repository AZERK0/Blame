import { contextBridge, ipcRenderer } from "electron";
import type { AgentEvent } from "@blame/agent-runtime";
import type { BlameDesktopApi } from "./types";

const api: BlameDesktopApi = {
  openDirectoryPicker: (options) =>
    ipcRenderer.invoke("dialog:open-directory", options),
  openExternalLink: (url) => ipcRenderer.send("shell:open-external", url),
  openPath: (path) => ipcRenderer.invoke("shell:open-path", path),
  platform: process.platform,
  updates: {
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    getStatus: () => ipcRenderer.invoke("updates:get-status"),
    install: () => ipcRenderer.invoke("updates:install"),
    onStatus: (callback) => {
      const handler = (
        _event: unknown,
        status: Parameters<typeof callback>[0],
      ) => callback(status);
      ipcRenderer.on("updates:status", handler);
      return () => ipcRenderer.removeListener("updates:status", handler);
    },
  },
  windowControls: {
    close: () => ipcRenderer.send("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
    minimize: () => ipcRenderer.invoke("window:minimize"),
    onMaximized: (callback) => {
      const handler = (_event: unknown, maximized: boolean) =>
        callback(maximized);
      ipcRenderer.on("window:maximized", handler);
      return () => ipcRenderer.removeListener("window:maximized", handler);
    },
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
  },
  previewBrowser: {
    capture: (input) => ipcRenderer.invoke("preview-browser:capture", input),
    create: () => ipcRenderer.invoke("preview-browser:create"),
    destroy: (input) => ipcRenderer.invoke("preview-browser:destroy", input),
    load: (input) => ipcRenderer.invoke("preview-browser:load", input),
    onState: (input, callback) => {
      const channel = `preview-browser:state:${input.id}`;
      const handler = (
        _event: unknown,
        state: Parameters<typeof callback>[0],
      ) => callback(state);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
    reload: (input) => ipcRenderer.invoke("preview-browser:reload", input),
    setBounds: (input) =>
      ipcRenderer.invoke("preview-browser:set-bounds", input),
  },
  workspace: {
    pathExists: (input) => ipcRenderer.invoke("workspace:path-exists", input),
    listDirectory: (input) =>
      ipcRenderer.invoke("workspace:list-directory", input),
    readFile: (input) => ipcRenderer.invoke("workspace:read-file", input),
    searchFiles: (input) => ipcRenderer.invoke("workspace:search-files", input),
    gitDiff: (input) => ipcRenderer.invoke("workspace:git-diff", input),
    gitRepositoryFingerprint: (input) =>
      ipcRenderer.invoke("workspace:git-repository-fingerprint", input),
    ensureGitRepository: (input) =>
      ipcRenderer.invoke("workspace:ensure-git-repository", input),
    createProject: (input) =>
      ipcRenderer.invoke("workspace:create-project", input),
    createWorktree: (input) =>
      ipcRenderer.invoke("workspace:create-worktree", input),
    checkHostDependencies: (input) =>
      ipcRenderer.invoke("workspace:check-host-dependencies", input),
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
    onProjectCreationEvent: (runId, callback) => {
      const channel = `workspace:project-creation:event:${runId}`;
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
      startDevelopment: (input) =>
        ipcRenderer.invoke("agent:sessions:start-development", input),
      send: (input) => ipcRenderer.invoke("agent:sessions:send", input),
      sendDevelopment: (input) =>
        ipcRenderer.invoke("agent:sessions:send-development", input),
      abort: (sessionId) =>
        ipcRenderer.invoke("agent:sessions:abort", sessionId),
      list: () => ipcRenderer.invoke("agent:sessions:list"),
      messages: (sessionId) =>
        ipcRenderer.invoke("agent:sessions:messages", sessionId),
      usage: (sessionId) =>
        ipcRenderer.invoke("agent:sessions:usage", sessionId),
      eventStreamUrl: (sessionId) =>
        ipcRenderer.invoke("agent:sessions:event-stream-url", sessionId),
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
    newProjects: {
      generate: (input) => ipcRenderer.invoke("agent:new-projects:generate", input),
    },
    promptOptimizer: {
      optimizeUserStory: (input) =>
        ipcRenderer.invoke("agent:prompt-optimizer:optimize-user-story", input),
    },
    approveAndMerge: (input) =>
      ipcRenderer.invoke("agent:approve-and-merge", input),
  },
};

contextBridge.exposeInMainWorld("blame", api);
