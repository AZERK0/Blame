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
  id: string;
  owner: BrowserWindow;
  view: WebContentsView;
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

const previews = new Map<string, PreviewBrowserRecord>();
const previewDevtoolsPort =
  Number(process.env.BLAME_PREVIEW_DEVTOOLS_PORT) || 9222;
const previewDevtoolsBrowserUrl = `http://127.0.0.1:${previewDevtoolsPort}`;
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

export function getPreviewDevtoolsTarget(): PreviewDevtoolsTarget {
  return {
    available: Boolean(activePreviewDevtoolsTarget),
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
      input: { bounds: PreviewBrowserBounds; id: string; visible: boolean },
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
  const record = { id, owner, view };
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
  id: string;
  visible: boolean;
}) {
  const record = previews.get(input.id);
  if (!record) return false;
  record.view.setBounds(normalizedBounds(input.bounds));
  record.view.setVisible(input.visible);
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
  activePreviewDevtoolsTarget = nextState;
  if (record.owner.isDestroyed()) return;
  record.owner.webContents.send(`preview-browser:state:${record.id}`, nextState);
}

function clearActivePreviewDevtoolsTarget(id: string) {
  if (activePreviewDevtoolsTarget?.id === id)
    activePreviewDevtoolsTarget = undefined;
}

function normalizedBounds(bounds: PreviewBrowserBounds) {
  return {
    height: Math.max(0, Math.round(bounds.height)),
    width: Math.max(0, Math.round(bounds.width)),
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
  };
}
