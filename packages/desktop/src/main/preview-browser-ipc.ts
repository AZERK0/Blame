import { randomUUID } from "node:crypto";
import {
  app,
  BrowserWindow,
  type IpcMainInvokeEvent,
  ipcMain,
  shell,
  WebContentsView,
} from "electron";

type PreviewBrowserRecord = {
  devtoolsTarget: boolean;
  id: string;
  owner: BrowserWindow;
  state?: PreviewBrowserState;
  view: WebContentsView;
  visible: boolean;
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
  timeoutMs?: number;
};

const previews = new Map<string, PreviewBrowserRecord>();
const previewDevtoolsPort =
  Number(process.env.BLAME_PREVIEW_DEVTOOLS_PORT) || 9222;
const previewDevtoolsBrowserUrl = `http://127.0.0.1:${previewDevtoolsPort}`;
const previewDevtoolsPollIntervalMs = 1_000;
const previewDevtoolsWaitTimeoutMs = 180_000;
let activePreviewDevtoolsTarget: PreviewBrowserState | undefined;

export type PreviewDevtoolsTarget = {
  available: boolean;
  browserUrl: string;
  currentUrl?: string;
  id?: string;
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
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (activePreviewDevtoolsTargetReady()) return previewDevtoolsTarget(true);
    await delay(previewDevtoolsPollIntervalMs);
  }
  return previewDevtoolsTarget(false);
}

function previewDevtoolsTarget(available: boolean): PreviewDevtoolsTarget {
  return {
    available,
    browserUrl: previewDevtoolsBrowserUrl,
    currentUrl: activePreviewDevtoolsTarget?.url,
    id: activePreviewDevtoolsTarget?.id,
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
  };
}

function activePreviewDevtoolsTargetReady() {
  return Boolean(
    activePreviewDevtoolsTarget?.url &&
      !activePreviewDevtoolsTarget.loading &&
      !activePreviewDevtoolsTarget.error,
  );
}

function normalizedPreviewDevtoolsTimeout(value: number | undefined) {
  if (!Number.isFinite(value) || !value) return previewDevtoolsWaitTimeoutMs;
  return Math.max(1_000, Math.min(value, 300_000));
}

export function registerPreviewBrowserIpcHandlers() {
  ipcMain.handle("preview-browser:create", (event) =>
    createPreviewBrowser(event),
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
        devtoolsTarget?: boolean;
        id: string;
        visible: boolean;
      },
    ) => setPreviewBrowserBounds(input),
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

function createPreviewBrowser(event: IpcMainInvokeEvent) {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner) throw new Error("Preview owner window not found");
  const id = randomUUID();
  const view = createPreviewBrowserView();
  const record = { devtoolsTarget: false, id, owner, view, visible: false };
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
  owner.once("closed", () => destroyPreviewBrowser(id));
  return { id };
}

function createPreviewBrowserView() {
  return new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
}

async function loadPreviewBrowser(input: { id: string; url: string }) {
  const record = previews.get(input.id);
  if (!record) return false;
  await record.view.webContents.loadURL(input.url);
  return true;
}

function setPreviewBrowserBounds(input: {
  bounds: PreviewBrowserBounds;
  devtoolsTarget?: boolean;
  id: string;
  visible: boolean;
}) {
  const record = previews.get(input.id);
  if (!record) return false;
  const bounds = normalizedBounds(input.bounds);
  const visible = input.visible && bounds.width > 0 && bounds.height > 0;
  if ("devtoolsTarget" in input)
    record.devtoolsTarget = Boolean(input.devtoolsTarget);
  record.visible = visible;
  record.view.setBounds(bounds);
  record.view.setVisible(visible);
  syncActivePreviewDevtoolsTarget(record, previewBrowserState(record));
  return true;
}

function reloadPreviewBrowser(input: { id: string }) {
  const record = previews.get(input.id);
  if (!record) return false;
  record.view.webContents.reload();
  return true;
}

function destroyPreviewBrowser(id: string) {
  const record = previews.get(id);
  if (!record) return false;
  previews.delete(id);
  clearActivePreviewDevtoolsTarget(id);
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
  const image = await record.view.webContents.capturePage();
  if (image.isEmpty()) return null;
  if (size === "thumbnail")
    return image.resize({ height: 24, quality: "good", width: 24 }).toDataURL();
  return image.toDataURL();
}

function attachPreviewBrowserEvents(record: PreviewBrowserRecord) {
  record.view.webContents.on("did-start-loading", () =>
    sendPreviewBrowserState(record, { loading: true }),
  );
  record.view.webContents.on("did-stop-loading", () =>
    sendPreviewBrowserState(record, { loading: false }),
  );
  record.view.webContents.on("did-finish-load", () =>
    sendPreviewBrowserState(record, { loading: false }),
  );
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
      sendPreviewBrowserState(record, {
        error: description,
        loading: false,
        url: validatedUrl,
      });
    },
  );
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
  syncActivePreviewDevtoolsTarget(record, nextState);
  if (record.owner.isDestroyed()) return;
  record.owner.webContents.send(`preview-browser:state:${record.id}`, nextState);
}

function previewBrowserState(record: PreviewBrowserRecord) {
  if (record.state) return record.state;
  return {
    id: record.id,
    loading: record.view.webContents.isLoading(),
    url: record.view.webContents.getURL(),
  } satisfies PreviewBrowserState;
}

function syncActivePreviewDevtoolsTarget(
  record: PreviewBrowserRecord,
  state: PreviewBrowserState,
) {
  if (record.visible || record.devtoolsTarget) {
    activePreviewDevtoolsTarget = state;
    return;
  }
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
