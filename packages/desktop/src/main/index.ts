import { homedir } from "node:os"
import { join } from "node:path"
import { shutdownBlameTelemetry } from "@blame/telemetry"
import contextMenu from "electron-context-menu"
import windowState from "electron-window-state"
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  screen,
  shell,
  type BrowserWindowConstructorOptions,
  type Display,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron"
import { registerAgentIpcHandlers, shutdownAgentRuntime } from "./agent-ipc"
import { registerBacklogStatusPipIpcHandlers } from "./backlog-status-pip-ipc"
import { desktopAppIdentity } from "./desktop-app-identity"
import { desktopResourcePaths } from "./desktop-resource-paths"
import {
  attachLiveLogWindow,
  flushLiveLogs,
  registerLiveLogCapture,
} from "./desktop-live-log"
import { checkForUpdatesOnStartup, registerDesktopUpdateIpcHandlers } from "./desktop-update-ipc"
import {
  destroyAllPreviewBrowsers,
  enablePreviewDevtools,
  registerPreviewBrowserIpcHandlers,
} from "./preview-browser-ipc"
import { registerTerminalIpcHandlers, shutdownTerminalSessions } from "./terminal-ipc"
import { registerTelemetryIpcHandlers } from "./telemetry-ipc"
import { registerWorkspaceIpcHandlers, shutdownWorkspaceProcesses } from "./workspace-ipc"
import { registerMcpIpcHandlers } from "./mcp-ipc"

contextMenu({
  showInspectElement: true,
  showLookUpSelection: false,
  showSaveImageAs: true,
  showSearchWithGoogle: false,
})

const desktopResources = desktopResourcePaths(app.getAppPath())
const runtimeShutdownTimeoutMs = 4_000
const telemetryShutdownTimeoutMs = 4_000
const defaultWindowWidth = 1440
const defaultWindowHeight = 900
const appMinWindowWidth = 960
const appMinWindowHeight = 640
const freeWindowMaxSize = 100000
const initialWindowShowFallbackMs = 8_000
const onboardingWindows = {
  connect: {
    height: 680,
    title: "Blame - Connect",
    width: 820,
  },
  welcome: {
    height: 680,
    title: "Blame - Welcome",
    width: 820,
  },
}
type WindowBounds = { height: number; width: number; x: number; y: number }

try {
  process.chdir(homedir())
} catch {}

const appIdentity = desktopAppIdentity(app.isPackaged)
const billingDeepLink = "blame://billing/refresh"
app.setName(appIdentity.name)
app.setAppUserModelId(appIdentity.appId)
app.setPath("userData", join(app.getPath("appData"), appIdentity.appId))
app.setAsDefaultProtocolClient("blame")
enablePreviewDevtools()
registerLiveLogCapture()

const singleInstanceLock = app.requestSingleInstanceLock()

if (!singleInstanceLock) app.exit(0)

let mainWindow: BrowserWindow | undefined
let shutdownPromise: Promise<void> | undefined
let shutdownRequested = false
let readyToQuit = false
let pendingBillingRefresh = process.argv.some((argument) => argument === billingDeepLink)

void app.whenReady().then(() => {
  registerIpcHandlers()
  registerBacklogStatusPipIpcHandlers({
    mainWindow: () => mainWindow,
    preloadPath: desktopResources.preload,
    rendererFile: desktopResources.renderer,
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
  })
  registerAgentIpcHandlers()
  registerPreviewBrowserIpcHandlers()
  registerMcpIpcHandlers()
  registerTerminalIpcHandlers()
  registerTelemetryIpcHandlers()
  registerDesktopUpdateIpcHandlers({
    async beforeInstall() {
      shutdownRequested = true
      await shutdownApplication()
      readyToQuit = true
    },
  })
  registerWorkspaceIpcHandlers()
  mainWindow = createMainWindow()
  checkForUpdatesOnStartup()
})

app.on("activate", () => {
  if (shutdownRequested) return
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
})

app.on("second-instance", (_event, commandLine) => {
  if (shutdownRequested) return
  showMainWindow()
  handleDeepLink(commandLine.find((argument) => argument.startsWith("blame://")))
})

app.on("open-url", (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", (event) => {
  shutdownRequested = true
  if (readyToQuit) return
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
    title: appIdentity.name,
    autoHideMenuBar: true,
    backgroundColor: "#00000000",
    frame: false,
    transparent: process.platform !== "win32",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: desktopResources.preload,
      sandbox: true,
    },
    ...(process.platform === "win32" ? windowsWindowOptions() : {}),
    ...(process.platform === "darwin" ? macosWindowOptions() : {}),
  }
  const window = new BrowserWindow(options)

  window.on("close", (event) => {
    if (process.platform === "darwin" || readyToQuit) return
    event.preventDefault()
    shutdownRequested = true
    void quitGracefully()
  })
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined
  })

  hidePlatformWindowButtons(window)
  state.manage(window)
  attachLiveLogWindow(window)
  registerWindowStateEvents(window)
  loadRenderer(window)
  scheduleInitialWindowShow(window)
  return window
}

function getDefaultWindowSize() {
  const { workAreaSize } = screen.getPrimaryDisplay()
  return {
    height: Math.min(defaultWindowHeight, Math.floor(workAreaSize.height * 0.9)),
    width: Math.min(defaultWindowWidth, Math.floor(workAreaSize.width * 0.9)),
  }
}

function fitWindowBounds(
  bounds: { height: number; width: number; x?: number; y?: number },
  targetDisplay = screen.getDisplayMatching({
    height: bounds.height,
    width: bounds.width,
    x: bounds.x ?? 0,
    y: bounds.y ?? 0,
  })
) {
  const display = targetDisplay
  const area = display.workArea
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  const x = clamp(
    bounds.x ?? area.x + Math.round((area.width - width) / 2),
    area.x,
    area.x + area.width - width
  )
  const y = clamp(
    bounds.y ?? area.y + Math.round((area.height - height) / 2),
    area.y,
    area.y + area.height - height
  )
  return { height, width, x, y }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function handleDeepLink(url: string | undefined) {
  if (url !== billingDeepLink) return
  pendingBillingRefresh = true
  showMainWindow()
  if (!mainWindow || mainWindow.webContents.isLoading()) return
  pendingBillingRefresh = false
  mainWindow.webContents.send("billing:refresh-license")
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
  void window.loadFile(desktopResources.renderer)
}

function registerIpcHandlers() {
  ipcMain.handle("notifications:show", (_event, input) => {
    return showSystemNotification(input)
  })

  ipcMain.handle("window:is-maximized", (event) => {
    return getEventWindow(event)?.isMaximized() ?? false
  })

  ipcMain.handle("window:minimize", (event) => {
    getEventWindow(event)?.minimize()
  })

  ipcMain.handle("window:set-presentation", (event, input) => {
    return setWindowPresentation(getEventWindow(event), input)
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

  ipcMain.on("billing:renderer-ready", (event) => {
    if (!pendingBillingRefresh) return
    pendingBillingRefresh = false
    event.sender.send("billing:refresh-license")
  })

  ipcMain.handle("shell:open-path", (_event, path: string) => {
    return shell.openPath(path)
  })
}

function setWindowPresentation(window: BrowserWindow | null, input: unknown) {
  if (!window || !windowPresentationInput(input)) return false
  if (input.mode === "app") {
    setAppWindowPresentation(window)
    return true
  }
  setOnboardingWindowPresentation(window, input.mode)
  return true
}

function setOnboardingWindowPresentation(
  window: BrowserWindow,
  mode: "connect" | "welcome"
) {
  const presentation = onboardingWindows[mode]
  if (window.isMaximized()) window.unmaximize()
  window.setTitle(presentation.title)
  window.setAlwaysOnTop(false)
  applyOnboardingWindowSize(window, presentation)
  showPresentedWindow(window)
}

function setAppWindowPresentation(window: BrowserWindow) {
  window.setTitle(appIdentity.name)
  window.setResizable(true)
  window.setMaximumSize(freeWindowMaxSize, freeWindowMaxSize)
  window.setMinimumSize(appMinWindowWidth, appMinWindowHeight)
  resizeWindow(window, defaultWindowWidth, defaultWindowHeight, {
    display: getPreferredDisplay(window),
  })
  showPresentedWindow(window)
}

function scheduleInitialWindowShow(window: BrowserWindow) {
  window.once("ready-to-show", () => {
    setTimeout(() => {
      if (!window.isDestroyed() && !window.isVisible()) window.show()
    }, initialWindowShowFallbackMs)
  })
}

function showPresentedWindow(window: BrowserWindow) {
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
}

function resizeWindow(
  window: BrowserWindow,
  width: number,
  height: number,
  options?: { bounds?: WindowBounds; display?: Display }
) {
  const bounds =
    options?.bounds ?? fitWindowBounds({ height, width }, options?.display)
  window.setBounds(bounds, true)
}

function applyOnboardingWindowSize(
  window: BrowserWindow,
  presentation: { height: number; width: number }
) {
  window.setResizable(true)
  window.setMinimumSize(1, 1)
  window.setMaximumSize(freeWindowMaxSize, freeWindowMaxSize)
  resizeWindow(window, presentation.width, presentation.height, {
    display: getPreferredDisplay(window),
  })
  window.setMinimumSize(presentation.width, presentation.height)
  window.setMaximumSize(presentation.width, presentation.height)
  window.setResizable(false)
}

function getPreferredDisplay(window: BrowserWindow) {
  if (window.isVisible()) return screen.getDisplayMatching(window.getBounds())
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

function windowPresentationInput(input: unknown): input is {
  mode: "app" | "connect" | "welcome"
} {
  if (!input || typeof input !== "object") return false
  const mode = (input as Record<string, unknown>).mode
  return mode === "app" || mode === "connect" || mode === "welcome"
}

function showSystemNotification(input: unknown) {
  if (!Notification.isSupported()) return false
  if (!systemNotificationInput(input)) return false
  new Notification(input).show()
  return true
}

function systemNotificationInput(input: unknown): input is {
  body?: string
  title: string
} {
  if (!input || typeof input !== "object") return false
  const record = input as Record<string, unknown>
  if (typeof record.title !== "string" || !record.title.trim()) return false
  if (record.body !== undefined && typeof record.body !== "string")
    return false
  return true
}

function registerWindowStateEvents(window: BrowserWindow) {
  window.on("maximize", () => window.webContents.send("window:maximized", true))
  window.on("unmaximize", () => window.webContents.send("window:maximized", false))
}

function getEventWindow(event: IpcMainInvokeEvent | IpcMainEvent) {
  return BrowserWindow.fromWebContents(event.sender)
}

async function quitGracefully() {
  shutdownRequested = true
  await shutdownApplication()
  readyToQuit = true
  app.quit()
}

async function exitFromSignal() {
  await shutdownApplication()
  app.exit(0)
}

function shutdownApplication() {
  if (!shutdownPromise) shutdownPromise = cleanupApplication()
  return shutdownPromise
}

async function cleanupApplication() {
  destroyAllPreviewBrowsers()
  const runtimeShutdown = Promise.allSettled([
    shutdownTerminalSessions(),
    shutdownWorkspaceProcesses(),
    shutdownAgentRuntime(),
  ]).then(() => undefined)
  await settleWithin(runtimeShutdown, runtimeShutdownTimeoutMs)
  await settleWithin(shutdownBlameTelemetry(), telemetryShutdownTimeoutMs)
  await settleWithin(flushLiveLogs(), telemetryShutdownTimeoutMs)
}

function settleWithin(task: Promise<void>, timeout: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeout)
    void task.then(
      () => {
        clearTimeout(timer)
        resolve()
      },
      () => {
        clearTimeout(timer)
        resolve()
      }
    )
  })
}
