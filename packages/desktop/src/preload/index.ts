import { contextBridge, ipcRenderer } from "electron";
import type { AgentEvent } from "@blame/agent-runtime";
import type { BlameDesktopApi } from "./types";

type AuthCallback = Parameters<BlameDesktopApi["auth"]["onCallback"]>[0];
type AuthCallbackResult = Parameters<AuthCallback>[0];
type AuthCallbackDelivery = {
  id: number;
  result: AuthCallbackResult;
};

const authCallbacks = new Set<AuthCallback>();
const deliveredAuthCallbackIds = new Set<number>();

function deliverAuthCallback(value: unknown) {
  if (!isAuthCallbackDelivery(value) || authCallbacks.size === 0) return;
  if (deliveredAuthCallbackIds.has(value.id)) {
    ipcRenderer.send("auth:callback-received", value.id);
    return;
  }
  deliveredAuthCallbackIds.add(value.id);
  try {
    for (const callback of authCallbacks) callback(value.result);
  } finally {
    ipcRenderer.send("auth:callback-received", value.id);
  }
}

function isAuthCallbackDelivery(value: unknown): value is AuthCallbackDelivery {
  if (!value || typeof value !== "object") return false;
  const delivery = value as Partial<AuthCallbackDelivery>;
  return Number.isSafeInteger(delivery.id) && Boolean(delivery.result);
}

ipcRenderer.on("auth:callback", (_event, delivery) => {
  deliverAuthCallback(delivery);
});

const api: BlameDesktopApi = {
  auth: {
    request: (input) => ipcRenderer.invoke("cloud-auth:request", input),
    ready: () => {
      void ipcRenderer
        .invoke("auth:renderer-ready")
        .then(deliverAuthCallback)
        .catch(() => undefined);
    },
    onCallback: (callback) => {
      authCallbacks.add(callback);
      return () => authCallbacks.delete(callback);
    },
  },
  billing: {
    ready: () => ipcRenderer.send("billing:renderer-ready"),
    onRefreshLicense: (callback) => {
      const handler = () => callback();
      ipcRenderer.on("billing:refresh-license", handler);
      return () =>
        ipcRenderer.removeListener("billing:refresh-license", handler);
    },
  },
  telemetry: {
    configure: (session) => ipcRenderer.invoke("telemetry:configure", session),
    disable: () => ipcRenderer.invoke("telemetry:disable"),
    sendRuntimeDiagnostic: (input) =>
      ipcRenderer.invoke("telemetry:send-runtime-diagnostic", input),
  },
  mcp: {
    authorize: (name) => ipcRenderer.invoke("mcp:authorize", name),
    disconnectOAuth: (name) => ipcRenderer.invoke("mcp:disconnect-oauth", name),
    detachCloud: (userId) => ipcRenderer.invoke("mcp:detach-cloud", userId),
    list: () => ipcRenderer.invoke("mcp:list"),
    mergeCloud: (userId, servers, adoptLocal) =>
      ipcRenderer.invoke("mcp:merge-cloud", userId, servers, adoptLocal),
    save: (server, previousName) =>
      ipcRenderer.invoke("mcp:save", server, previousName),
    remove: (name) => ipcRenderer.invoke("mcp:remove", name),
    setEnabled: (name, enabled) =>
      ipcRenderer.invoke("mcp:set-enabled", name, enabled),
  },
  openDirectoryPicker: (options) =>
    ipcRenderer.invoke("dialog:open-directory", options),
  openExternalLink: (url) => ipcRenderer.send("shell:open-external", url),
  openPath: (path) => ipcRenderer.invoke("shell:open-path", path),
  backlogStatusPip: {
    onRequest: (callback) => {
      const handler = (
        _event: unknown,
        request: Parameters<typeof callback>[0],
      ) => callback(request);
      ipcRenderer.on("backlog-status-pip:request", handler);
      return () =>
        ipcRenderer.removeListener("backlog-status-pip:request", handler);
    },
    onSnapshot: (callback) => {
      const handler = (
        _event: unknown,
        snapshot: Parameters<typeof callback>[0],
      ) => callback(snapshot);
      ipcRenderer.on("backlog-status-pip:snapshot", handler);
      return () =>
        ipcRenderer.removeListener("backlog-status-pip:snapshot", handler);
    },
    open: () => ipcRenderer.invoke("backlog-status-pip:open"),
    publish: (snapshot) =>
      ipcRenderer.send("backlog-status-pip:snapshot", snapshot),
    request: (input) => ipcRenderer.invoke("backlog-status-pip:request", input),
  },
  platform: process.platform,
  systemNotifications: {
    show: (input) => ipcRenderer.invoke("notifications:show", input),
  },
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
    setPresentation: (input) =>
      ipcRenderer.invoke("window:set-presentation", input),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
  },
  previewBrowser: {
    capture: (input) => ipcRenderer.invoke("preview-browser:capture", input),
    create: (input) => ipcRenderer.invoke("preview-browser:create", input),
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
    setDevtoolsScope: (input) =>
      ipcRenderer.invoke("preview-browser:set-devtools-scope", input),
    setBounds: (input) =>
      ipcRenderer.invoke("preview-browser:set-bounds", input),
  },
  workspace: {
    pathExists: (input) => ipcRenderer.invoke("workspace:path-exists", input),
    optimizeAttachmentForAiContext: (input) =>
      ipcRenderer.invoke("workspace:optimize-attachment-for-ai-context", input),
    listDirectory: (input) =>
      ipcRenderer.invoke("workspace:list-directory", input),
    readFile: (input) => ipcRenderer.invoke("workspace:read-file", input),
    searchFiles: (input) => ipcRenderer.invoke("workspace:search-files", input),
    gitDiff: (input) => ipcRenderer.invoke("workspace:git-diff", input),
    gitDiffStats: (input) =>
      ipcRenderer.invoke("workspace:git-diff-stats", input),
    gitDiffBetween: (input) =>
      ipcRenderer.invoke("workspace:git-diff-between", input),
    gitDiffFrom: (input) =>
      ipcRenderer.invoke("workspace:git-diff-from", input),
    gitSnapshot: (input) => ipcRenderer.invoke("workspace:git-snapshot", input),
    gitStatus: (input) => ipcRenderer.invoke("workspace:git-status", input),
    gitCommitCount: (input) =>
      ipcRenderer.invoke("workspace:git-commit-count", input),
    gitLog: (input) => ipcRenderer.invoke("workspace:git-log", input),
    gitFileDiff: (input) =>
      ipcRenderer.invoke("workspace:git-file-diff", input),
    gitCommitDiff: (input) =>
      ipcRenderer.invoke("workspace:git-commit-diff", input),
    gitConflictFile: (input) =>
      ipcRenderer.invoke("workspace:git-conflict-file", input),
    gitAcceptConflictFile: (input) =>
      ipcRenderer.invoke("workspace:git-accept-conflict-file", input),
    gitResolveConflictFile: (input) =>
      ipcRenderer.invoke("workspace:git-resolve-conflict-file", input),
    gitAbortConflict: (input) =>
      ipcRenderer.invoke("workspace:git-abort-conflict", input),
    gitContinueConflict: (input) =>
      ipcRenderer.invoke("workspace:git-continue-conflict", input),
    gitStageFiles: (input) =>
      ipcRenderer.invoke("workspace:git-stage-files", input),
    gitUnstageFiles: (input) =>
      ipcRenderer.invoke("workspace:git-unstage-files", input),
    gitRollbackFiles: (input) =>
      ipcRenderer.invoke("workspace:git-rollback-files", input),
    gitDeleteFiles: (input) =>
      ipcRenderer.invoke("workspace:git-delete-files", input),
    gitCommit: (input) => ipcRenderer.invoke("workspace:git-commit", input),
    gitPush: (input) => ipcRenderer.invoke("workspace:git-push", input),
    listGitDirectory: (input) =>
      ipcRenderer.invoke("workspace:list-git-directory", input),
    readGitFile: (input) =>
      ipcRenderer.invoke("workspace:read-git-file", input),
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
    collectProjectInitializationDiagnostics: (input) =>
      ipcRenderer.invoke(
        "workspace:collect-project-initialization-diagnostics",
        input,
      ),
    stopProjectSetup: (input) =>
      ipcRenderer.invoke("workspace:stop-project-setup", input),
    removeWorktree: (input) =>
      ipcRenderer.invoke("workspace:remove-worktree", input),
    resolveProjectPreviewUrl: (input) =>
      ipcRenderer.invoke("workspace:resolve-project-preview-url", input),
    ensureProjectPreviewUrl: (input) =>
      ipcRenderer.invoke("workspace:ensure-project-preview-url", input),
    ensureRuntimeReady: () =>
      ipcRenderer.invoke("workspace:ensure-runtime-ready"),
    repairRuntime: () => ipcRenderer.invoke("workspace:repair-runtime"),
    resetRuntime: () => ipcRenderer.invoke("workspace:reset-runtime"),
    projectRuntimeHealthy: (input) =>
      ipcRenderer.invoke("workspace:project-runtime-healthy", input),
    projectPreviewRuntimeState: (input) =>
      ipcRenderer.invoke("workspace:project-preview-runtime-state", input),
    controlProjectPreview: (input) =>
      ipcRenderer.invoke("workspace:control-project-preview", input),
    listProjectServices: (input) =>
      ipcRenderer.invoke("workspace:list-project-services", input),
    startProjectServiceLogs: (input) =>
      ipcRenderer.invoke("workspace:start-project-service-logs", input),
    stopProjectServiceLogs: (input) =>
      ipcRenderer.invoke("workspace:stop-project-service-logs", input),
    onProjectServiceLog: (streamId, callback) => {
      const channel = `workspace:project-service-log:${streamId}`;
      const handler = (
        _event: unknown,
        event: Parameters<typeof callback>[0],
      ) => callback(event);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
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
      compareCheckpoint: (input) =>
        ipcRenderer.invoke("agent:sessions:compare-checkpoint", input),
      list: () => ipcRenderer.invoke("agent:sessions:list"),
      messages: (sessionId) =>
        ipcRenderer.invoke("agent:sessions:messages", sessionId),
      restoreCheckpoint: (input) =>
        ipcRenderer.invoke("agent:sessions:restore-checkpoint", input),
      usage: (sessionId) =>
        ipcRenderer.invoke("agent:sessions:usage", sessionId),
      eventStreamUrl: (sessionId) =>
        ipcRenderer.invoke("agent:sessions:event-stream-url", sessionId),
      onEvent: (sessionId, callback) => {
        const channel = `agent:sessions:event:${sessionId}`;
        const handler = (_event: unknown, event: AgentEvent) => callback(event);
        ipcRenderer.on(channel, handler);
        ipcRenderer.send("agent:sessions:listen", sessionId);
        return () => {
          ipcRenderer.removeListener(channel, handler);
          ipcRenderer.send("agent:sessions:unlisten", sessionId);
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
      repair: (input) =>
        ipcRenderer.invoke("agent:initializations:repair", input),
      assessImpact: (input) =>
        ipcRenderer.invoke("agent:initializations:assess-impact", input),
    },
    codePractices: {
      run: (input) => ipcRenderer.invoke("agent:code-practices:run", input),
    },
    newProjects: {
      generate: (input) =>
        ipcRenderer.invoke("agent:new-projects:generate", input),
    },
    promptOptimizer: {
      optimizeUserStory: (input) =>
        ipcRenderer.invoke("agent:prompt-optimizer:optimize-user-story", input),
      generateTitle: (input) =>
        ipcRenderer.invoke("agent:prompt-optimizer:generate-title", input),
    },
    approveAndMerge: (input) =>
      ipcRenderer.invoke("agent:approve-and-merge", input),
    generateCommitMessage: (input) =>
      ipcRenderer.invoke("agent:generate-commit-message", input),
    resolveMergeConflicts: (input) =>
      ipcRenderer.invoke("agent:resolve-merge-conflicts", input),
  },
};

contextBridge.exposeInMainWorld("blame", api);
