import { randomUUID } from "node:crypto";
import {
  app,
  BrowserWindow,
  type IpcMainInvokeEvent,
  ipcMain,
  shell,
  WebContentsView,
} from "electron";
import { getBlameTelemetry } from "@blame/telemetry";
import { previewPartition } from "./preview-browser-partition";

type PreviewBrowserRecord = {
  devtoolsScope?: string;
  id: string;
  owner: BrowserWindow;
  state?: PreviewBrowserState;
  view: WebContentsView;
  visible: boolean;
  loadTimeout?: NodeJS.Timeout;
};

type PreviewBrowserBounds = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type PreviewBrowserState = {
  error?: string;
  id: string;
  loading: boolean;
  url?: string;
};

type PreviewBrowserCaptureSize = "full" | "thumbnail";
type PreviewDevtoolsTargetInput = {
  scope?: string;
  timeoutMs?: number;
};

const previews = new Map<string, PreviewBrowserRecord>();
const previewLoadTimeoutMs = 30_000;
const previewDevtoolsPort =
  Number(process.env.BLAME_PREVIEW_DEVTOOLS_PORT) || 9222;
const previewDevtoolsBrowserUrl = `http://127.0.0.1:${previewDevtoolsPort}`;
const previewDevtoolsPollIntervalMs = 1_000;
const previewDevtoolsWaitTimeoutMs = 180_000;
let activePreviewDevtoolsTarget: PreviewBrowserState | undefined;
const previewDevtoolsTargets = new Map<string, PreviewBrowserState>();

export type PreviewDevtoolsTarget = {
  available: boolean;
  browserUrl: string;
  currentUrl?: string;
  id?: string;
  scope?: string;
  mcpServer: {
    args: string[];
    command: string;
    name: string;
  };
};

export function enablePreviewDevtools() {
  app.commandLine.appendSwitch(
    "remote-debugging-port",
    String(previewDevtoolsPort),
  );
}

export async function getPreviewDevtoolsTarget(
  input: PreviewDevtoolsTargetInput = {},
): Promise<PreviewDevtoolsTarget> {
  const timeoutMs = normalizedPreviewDevtoolsTimeout(input.timeoutMs);
  const scope = normalizedPreviewDevtoolsScope(input.scope);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const target = previewDevtoolsTargetForScope(scope);
    if (previewDevtoolsTargetReady(target))
      return previewDevtoolsTarget(true, target, scope);
    await delay(previewDevtoolsPollIntervalMs);
  }
  return previewDevtoolsTarget(
    false,
    previewDevtoolsTargetForScope(scope),
    scope,
  );
}

function previewDevtoolsTarget(
  available: boolean,
  target: PreviewBrowserState | undefined,
  scope: string | undefined,
): PreviewDevtoolsTarget {
  return {
    available,
    browserUrl: previewDevtoolsBrowserUrl,
    currentUrl: target?.url,
    id: target?.id,
    mcpServer: {
      args: [
        "-y",
        "chrome-devtools-mcp@latest",
        `--browser-url=${previewDevtoolsBrowserUrl}`,
        "--no-usage-statistics",
      ],
      command: "npx",
      name: "chrome-devtools",
    },
    ...(scope ? { scope } : {}),
  };
}

function previewDevtoolsTargetForScope(scope: string | undefined) {
  return scope
    ? previewDevtoolsTargets.get(scope)
    : activePreviewDevtoolsTarget;
}

function previewDevtoolsTargetReady(target: PreviewBrowserState | undefined) {
  return Boolean(target?.url && !target.loading && !target.error);
}

function normalizedPreviewDevtoolsScope(scope: string | undefined) {
  const normalized = scope?.trim();
  return normalized || undefined;
}

function normalizedPreviewDevtoolsTimeout(value: number | undefined) {
  if (!Number.isFinite(value) || !value) return previewDevtoolsWaitTimeoutMs;
  return Math.max(1_000, Math.min(value, 300_000));
}

export function registerPreviewBrowserIpcHandlers() {
  ipcMain.handle("preview-browser:create", (event, input: { storageKey: string }) =>
    createPreviewBrowser(event, input),
  );
  ipcMain.handle(
    "preview-browser:load",
    (_event, input: { id: string; url: string }) => loadPreviewBrowser(input),
  );
  ipcMain.handle(
    "preview-browser:set-bounds",
    (
      _event,
      input: {
        bounds: PreviewBrowserBounds;
        id: string;
        visible: boolean;
      },
    ) => setPreviewBrowserBounds(input),
  );
  ipcMain.handle(
    "preview-browser:set-devtools-scope",
    (_event, input: { id: string; scope?: string | null }) =>
      setPreviewBrowserDevtoolsScope(input),
  );
  ipcMain.handle("preview-browser:reload", (_event, input: { id: string }) =>
    reloadPreviewBrowser(input),
  );
  ipcMain.handle("preview-browser:destroy", (_event, input: { id: string }) =>
    destroyPreviewBrowser(input.id),
  );
  ipcMain.handle(
    "preview-browser:capture",
    (_event, input: { id: string; size?: PreviewBrowserCaptureSize }) =>
      capturePreviewBrowser(input.id, input.size ?? "full"),
  );
}

function createPreviewBrowser(
  event: IpcMainInvokeEvent,
  input: { storageKey: string },
) {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner) throw new Error("Preview owner window not found");
  if (!input.storageKey?.trim() || input.storageKey.length > 2_048)
    throw new Error("Preview storage key is invalid");
  const id = randomUUID();
  const view = createPreviewBrowserView(input.storageKey);
  const record = { id, owner, view, visible: false };
  previews.set(id, record);
  owner.contentView.addChildView(view);
  view.setBounds({ height: 0, width: 0, x: 0, y: 0 });
  view.setVisible(false);
  view.setBorderRadius(8);
  view.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  attachPreviewBrowserEvents(record);
  attachPreviewRequestTelemetry(record);
  owner.once("closed", () => destroyPreviewBrowser(id));
  return { id };
}

function createPreviewBrowserView(storageKey: string) {
  return new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: previewPartition(storageKey),
      sandbox: true,
    },
  });
}

function attachPreviewRequestTelemetry(record: PreviewBrowserRecord) {
  record.view.webContents.session.webRequest.onCompleted(
    { urls: ["http://*/*", "https://*/*"] },
    (details) => {
      if (details.statusCode < 500) return;
      const attributes = {
        "http.response.status_code": details.statusCode,
        "network.protocol.name": details.url.startsWith("https:")
          ? "https"
          : "http",
        "blame.preview.resource_type": previewResourceType(
          details.resourceType,
        ),
      };
      const telemetry = getBlameTelemetry();
      telemetry.count("blame.preview.http.server_error", 1, attributes);
      telemetry.log("warn", "blame.preview.request.failed", attributes);
    },
  );
}

function previewResourceType(value: string) {
  return ["mainFrame", "subFrame", "xhr", "fetch"].includes(value)
    ? value
    : "other";
}

async function loadPreviewBrowser(input: { id: string; url: string }) {
  const record = previews.get(input.id);
  if (!record) return false;
  startPreviewLoadTimeout(record, input.url);
  try {
    await record.view.webContents.loadURL(input.url);
  } finally {
    clearPreviewLoadTimeout(record);
  }
  return true;
}

function setPreviewBrowserBounds(input: {
  bounds: PreviewBrowserBounds;
  id: string;
  visible: boolean;
}) {
  const record = previews.get(input.id);
  if (!record) return false;
  const bounds = normalizedBounds(input.bounds);
  const visible = input.visible && bounds.width > 0 && bounds.height > 0;
  record.visible = visible;
  record.view.setBounds(bounds);
  record.view.setVisible(visible);
  record.view.webContents.setAudioMuted(!visible);
  syncPreviewDevtoolsTargets(record, previewBrowserState(record));
  return true;
}

function setPreviewBrowserDevtoolsScope(input: {
  id: string;
  scope?: string | null;
}) {
  const record = previews.get(input.id);
  if (!record) return false;
  clearPreviewDevtoolsScope(record);
  record.devtoolsScope = normalizedPreviewDevtoolsScope(
    input.scope ?? undefined,
  );
  syncPreviewDevtoolsTargets(record, previewBrowserState(record));
  return true;
}

function reloadPreviewBrowser(input: { id: string }) {
  const record = previews.get(input.id);
  if (!record) return false;
  startPreviewLoadTimeout(record, record.view.webContents.getURL());
  record.view.webContents.reload();
  return true;
}

function destroyPreviewBrowser(id: string) {
  const record = previews.get(id);
  if (!record) return false;
  previews.delete(id);
  clearPreviewLoadTimeout(record);
  clearPreviewDevtoolsTargets(record);
  if (!record.owner.isDestroyed())
    record.owner.contentView.removeChildView(record.view);
  if (!record.view.webContents.isDestroyed()) record.view.webContents.close();
  return true;
}

export function destroyAllPreviewBrowsers() {
  Array.from(previews.keys()).forEach((id) => destroyPreviewBrowser(id));
}

async function capturePreviewBrowser(
  id: string,
  size: PreviewBrowserCaptureSize,
) {
  const record = previews.get(id);
  if (!record || !record.view.getVisible()) return null;
  const image = await record.view.webContents.capturePage(
    size === "thumbnail" ? previewThumbnailBounds(record) : undefined,
  );
  if (image.isEmpty()) return null;
  if (size === "thumbnail")
    return image.resize({ height: 24, quality: "good", width: 24 }).toDataURL();
  return image.toDataURL();
}

function previewThumbnailBounds(record: PreviewBrowserRecord) {
  const bounds = record.view.getBounds();
  const width = Math.max(1, Math.min(96, bounds.width));
  const height = Math.max(1, Math.min(96, bounds.height));
  return {
    height,
    width,
    x: Math.max(0, Math.round((bounds.width - width) / 2)),
    y: Math.max(0, Math.round((bounds.height - height) / 2)),
  };
}

function attachPreviewBrowserEvents(record: PreviewBrowserRecord) {
  record.view.webContents.on("did-start-loading", () => {
    startPreviewLoadTimeout(record, record.view.webContents.getURL());
    sendPreviewBrowserState(record, { loading: true });
  });
  record.view.webContents.on("did-stop-loading", () => {
    clearPreviewLoadTimeout(record);
    sendPreviewBrowserState(record, { loading: false });
  });
  record.view.webContents.on("did-finish-load", () => {
    clearPreviewLoadTimeout(record);
    sendPreviewBrowserState(record, { loading: false });
  });
  record.view.webContents.on("did-navigate", (_event, url) =>
    sendPreviewBrowserState(record, { loading: false, url }),
  );
  record.view.webContents.on("did-navigate-in-page", (_event, url) =>
    sendPreviewBrowserState(record, { url }),
  );
  record.view.webContents.on(
    "did-fail-load",
    (_event, _code, description, validatedUrl, isMainFrame) => {
      if (!isMainFrame) return;
      clearPreviewLoadTimeout(record);
      sendPreviewBrowserState(record, {
        error: description,
        loading: false,
        url: validatedUrl,
      });
    },
  );
  record.view.webContents.on("render-process-gone", (_event, details) => {
    clearPreviewLoadTimeout(record);
    sendPreviewBrowserState(record, {
      error: `Preview renderer stopped (${details.reason}). Reload to recover.`,
      loading: false,
    });
  });
  record.view.webContents.on("unresponsive", () => {
    sendPreviewBrowserState(record, {
      error: "Preview renderer is not responding. Reload to recover.",
      loading: false,
    });
  });
}

function startPreviewLoadTimeout(record: PreviewBrowserRecord, url: string) {
  clearPreviewLoadTimeout(record);
  record.loadTimeout = setTimeout(() => {
    record.view.webContents.stop();
    sendPreviewBrowserState(record, {
      error: "Preview loading timed out. Reload to try again.",
      loading: false,
      url,
    });
  }, previewLoadTimeoutMs);
}

function clearPreviewLoadTimeout(record: PreviewBrowserRecord) {
  if (record.loadTimeout) clearTimeout(record.loadTimeout);
  record.loadTimeout = undefined;
}

function sendPreviewBrowserState(
  record: PreviewBrowserRecord,
  state: Partial<Omit<PreviewBrowserState, "id">>,
) {
  const nextState = {
    id: record.id,
    loading: state.loading ?? record.view.webContents.isLoading(),
    url: state.url ?? record.view.webContents.getURL(),
    ...(state.error ? { error: state.error } : {}),
  } satisfies PreviewBrowserState;
  record.state = nextState;
  syncPreviewDevtoolsTargets(record, nextState);
  if (record.owner.isDestroyed()) return;
  record.owner.webContents.send(
    `preview-browser:state:${record.id}`,
    nextState,
  );
}

function previewBrowserState(record: PreviewBrowserRecord) {
  if (record.state) return record.state;
  return {
    id: record.id,
    loading: record.view.webContents.isLoading(),
    url: record.view.webContents.getURL(),
  } satisfies PreviewBrowserState;
}

function syncPreviewDevtoolsTargets(
  record: PreviewBrowserRecord,
  state: PreviewBrowserState,
) {
  if (record.devtoolsScope)
    previewDevtoolsTargets.set(record.devtoolsScope, state);
  if (record.visible) {
    activePreviewDevtoolsTarget = state;
    return;
  }
  clearActivePreviewDevtoolsTarget(record.id);
}

function clearPreviewDevtoolsScope(record: PreviewBrowserRecord) {
  if (!record.devtoolsScope) return;
  const target = previewDevtoolsTargets.get(record.devtoolsScope);
  if (target?.id === record.id)
    previewDevtoolsTargets.delete(record.devtoolsScope);
}

function clearPreviewDevtoolsTargets(record: PreviewBrowserRecord) {
  clearPreviewDevtoolsScope(record);
  clearActivePreviewDevtoolsTarget(record.id);
}

function clearActivePreviewDevtoolsTarget(id: string) {
  if (activePreviewDevtoolsTarget?.id === id)
    activePreviewDevtoolsTarget = undefined;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizedBounds(bounds: PreviewBrowserBounds) {
  return {
    height: Math.max(0, Math.round(bounds.height)),
    width: Math.max(0, Math.round(bounds.width)),
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
  };
}
