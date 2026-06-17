import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import contextMenu from "electron-context-menu"
import windowState from "electron-window-state"
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  shell,
  type BrowserWindowConstructorOptions,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron"
import { registerAgentIpcHandlers, shutdownAgentRuntime } from "./agent-ipc"
import { attachLiveLogWindow, registerLiveLogCapture } from "./desktop-live-log"
import { checkForUpdatesOnStartup, registerDesktopUpdateIpcHandlers } from "./desktop-update-ipc"
import {
  destroyAllPreviewBrowsers,
  enablePreviewDevtools,
  registerPreviewBrowserIpcHandlers,
} from "./preview-browser-ipc"
import { registerTerminalIpcHandlers, shutdownTerminalSessions } from "./terminal-ipc"
import { registerWorkspaceIpcHandlers, shutdownWorkspaceProcesses } from "./workspace-ipc"

contextMenu({
  showInspectElement: true,
  showLookUpSelection: false,
  showSaveImageAs: true,
  showSearchWithGoogle: false,
})

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const shutdownTimeoutMs = 4_000
const defaultWindowWidth = 1440
const defaultWindowHeight = 900

try {
  process.chdir(homedir())
} catch {}

app.setName("Blame")
app.setAppUserModelId("dev.blame.desktop")
app.setPath("userData", join(app.getPath("appData"), "dev.blame.desktop"))
enablePreviewDevtools()
registerLiveLogCapture()

const singleInstanceLock = app.requestSingleInstanceLock()

if (!singleInstanceLock) app.exit(0)

let mainWindow: BrowserWindow | undefined
let shutdownPromise: Promise<void> | undefined
let quitAfterShutdown = false

void app.whenReady().then(() => {
  registerIpcHandlers()
  registerAgentIpcHandlers()
  registerPreviewBrowserIpcHandlers()
  registerTerminalIpcHandlers()
  registerDesktopUpdateIpcHandlers({
    beforeInstall() {
      quitAfterShutdown = true
    },
  })
  registerWorkspaceIpcHandlers()
  mainWindow = createMainWindow()
  checkForUpdatesOnStartup()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
})

app.on("second-instance", () => {
  showMainWindow()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", (event) => {
  if (quitAfterShutdown) return
  event.preventDefault()
  void quitGracefully()
})

process.once("SIGINT", () => {
  void exitFromSignal()
})

process.once("SIGTERM", () => {
  void exitFromSignal()
})

function createMainWindow() {
  const defaultSize = getDefaultWindowSize()
  const state = windowState({
    defaultHeight: defaultSize.height,
    defaultWidth: defaultSize.width,
  })
  const bounds = fitWindowBounds({
    height: state.height,
    width: state.width,
    x: state.x,
    y: state.y,
  })
  const options: BrowserWindowConstructorOptions = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    title: "Blame",
    autoHideMenuBar: true,
    backgroundColor: "#00000000",
    frame: false,
    transparent: process.platform !== "win32",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(currentDirectory, "../preload/index.js"),
      sandbox: true,
    },
    ...(process.platform === "win32" ? windowsWindowOptions() : {}),
    ...(process.platform === "darwin" ? macosWindowOptions() : {}),
  }
  const window = new BrowserWindow(options)

  hidePlatformWindowButtons(window)
  state.manage(window)
  attachLiveLogWindow(window)
  registerWindowStateEvents(window)
  loadRenderer(window)
  window.once("ready-to-show", () => window.show())
  return window
}

function getDefaultWindowSize() {
  const { workAreaSize } = screen.getPrimaryDisplay()
  return {
    height: Math.min(defaultWindowHeight, Math.floor(workAreaSize.height * 0.9)),
    width: Math.min(defaultWindowWidth, Math.floor(workAreaSize.width * 0.9)),
  }
}

function fitWindowBounds(bounds: { height: number; width: number; x?: number; y?: number }) {
  const display = screen.getDisplayMatching({
    height: bounds.height,
    width: bounds.width,
    x: bounds.x ?? 0,
    y: bounds.y ?? 0,
  })
  const area = display.workArea
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  const x = clamp(bounds.x ?? area.x + Math.round((area.width - width) / 2), area.x, area.x + area.width - width)
  const y = clamp(bounds.y ?? area.y + Math.round((area.height - height) / 2), area.y, area.y + area.height - height)
  return { height, width, x, y }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function showMainWindow() {
  const window = mainWindow ?? BrowserWindow.getAllWindows()[0]
  if (!window) {
    mainWindow = createMainWindow()
    return
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function windowsWindowOptions(): BrowserWindowConstructorOptions {
  return {
    backgroundMaterial: "acrylic",
  }
}

function macosWindowOptions(): BrowserWindowConstructorOptions {
  return {
    vibrancy: "under-window",
    visualEffectState: "active",
  }
}

function hidePlatformWindowButtons(window: BrowserWindow) {
  if (process.platform !== "darwin") return
  window.setWindowButtonVisibility(false)
}

function loadRenderer(window: BrowserWindow) {
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
    return
  }
  void window.loadFile(join(currentDirectory, "../renderer/index.html"))
}

function registerIpcHandlers() {
  ipcMain.handle("window:is-maximized", (event) => {
    return getEventWindow(event)?.isMaximized() ?? false
  })

  ipcMain.handle("window:minimize", (event) => {
    getEventWindow(event)?.minimize()
  })

  ipcMain.handle("window:toggle-maximize", (event) => {
    const window = getEventWindow(event)
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

  ipcMain.on("window:close", (event) => {
    getEventWindow(event)?.close()
  })

  ipcMain.handle("dialog:open-directory", async (_event, options?: { title?: string; multiple?: boolean }) => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", ...(options?.multiple ? ["multiSelections" as const] : [])],
      title: options?.title ?? "Open Project",
    })
    if (result.canceled) return null
    return options?.multiple ? result.filePaths : result.filePaths[0]
  })

  ipcMain.on("shell:open-external", (_event, url: string) => {
    void shell.openExternal(url)
  })

  ipcMain.handle("shell:open-path", (_event, path: string) => {
    return shell.openPath(path)
  })
}

function registerWindowStateEvents(window: BrowserWindow) {
  window.on("maximize", () => window.webContents.send("window:maximized", true))
  window.on("unmaximize", () => window.webContents.send("window:maximized", false))
}

function getEventWindow(event: IpcMainInvokeEvent | IpcMainEvent) {
  return BrowserWindow.fromWebContents(event.sender)
}

async function quitGracefully() {
  await shutdownApplication()
  quitAfterShutdown = true
  app.quit()
}

async function exitFromSignal() {
  await shutdownApplication()
  app.exit(0)
}

function shutdownApplication() {
  if (!shutdownPromise) shutdownPromise = withTimeout(cleanupApplication(), shutdownTimeoutMs)
  return shutdownPromise
}

async function cleanupApplication() {
  destroyAllPreviewBrowsers()
  await Promise.allSettled([
    shutdownTerminalSessions(),
    shutdownWorkspaceProcesses(),
    shutdownAgentRuntime(),
  ])
}

function withTimeout(task: Promise<void>, timeout: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeout)
    task.finally(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}
