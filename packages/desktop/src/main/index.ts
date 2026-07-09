import { execFile, execFileSync } from "node:child_process"
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
const appMinWindowWidth = 960
const appMinWindowHeight = 640
const freeWindowMaxSize = 100000
const initialWindowShowFallbackMs = 8_000
const presentationRetryDelaysMs = [0, 80, 180, 360, 720]
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
type WindowPresentation = { height: number; title: string; width: number }
type HyprlandPlacement = {
  bounds: WindowBounds
  hyprlandBounds?: WindowBounds
  workspace?: number | string
}

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
let hyprlandOnboardingFloating = false
let windowPresentationToken = 0
let hyprlandPresentationToken = 0

void app.whenReady().then(() => {
  registerIpcHandlers()
  registerBacklogStatusPipIpcHandlers({
    mainWindow: () => mainWindow,
    preloadPath: join(currentDirectory, "../preload/index.js"),
    rendererFile: join(currentDirectory, "../renderer/index.html"),
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
  })
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

  ipcMain.handle("shell:open-path", (_event, path: string) => {
    return shell.openPath(path)
  })
}

function setWindowPresentation(window: BrowserWindow | null, input: unknown) {
  if (!window || !windowPresentationInput(input)) return false
  const token = ++windowPresentationToken
  if (input.mode === "app") {
    setAppWindowPresentation(window)
    return true
  }
  setOnboardingWindowPresentation(window, input.mode, token)
  return true
}

function setOnboardingWindowPresentation(
  window: BrowserWindow,
  mode: "connect" | "welcome",
  token: number
) {
  const presentation = onboardingWindows[mode]
  const placement = getOnboardingPlacement(window, presentation)
  if (window.isMaximized()) window.unmaximize()
  window.setTitle(presentation.title)
  window.setAlwaysOnTop(false)
  applyOnboardingWindowSize(window, presentation, placement.bounds)
  showPresentedWindow(window)
  scheduleOnboardingWindowSize(window, presentation, placement.bounds, token)
  setHyprlandOnboardingWindow(presentation, true, placement)
}

function setAppWindowPresentation(window: BrowserWindow) {
  window.setTitle("Blame")
  window.setResizable(true)
  window.setMaximumSize(freeWindowMaxSize, freeWindowMaxSize)
  window.setMinimumSize(appMinWindowWidth, appMinWindowHeight)
  resizeWindow(window, defaultWindowWidth, defaultWindowHeight, {
    display: getPreferredDisplay(window),
  })
  showPresentedWindow(window)
  if (hyprlandOnboardingFloating)
    setHyprlandOnboardingWindow(
      {
        height: defaultWindowHeight,
        title: "Blame",
        width: defaultWindowWidth,
      },
      false
    )
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
  presentation: { height: number; width: number },
  bounds: WindowBounds
) {
  window.setResizable(true)
  window.setMinimumSize(1, 1)
  window.setMaximumSize(freeWindowMaxSize, freeWindowMaxSize)
  resizeWindow(window, presentation.width, presentation.height, { bounds })
  window.setMinimumSize(presentation.width, presentation.height)
  window.setMaximumSize(presentation.width, presentation.height)
  window.setResizable(false)
}

function scheduleOnboardingWindowSize(
  window: BrowserWindow,
  presentation: { height: number; width: number },
  bounds: WindowBounds,
  token: number
) {
  for (const delay of presentationRetryDelaysMs)
    setTimeout(() => {
      if (window.isDestroyed() || token !== windowPresentationToken) return
      applyOnboardingWindowSize(window, presentation, bounds)
    }, delay)
}

function getOnboardingPlacement(
  window: BrowserWindow,
  presentation: WindowPresentation
): HyprlandPlacement {
  const hyprlandPlacement = getHyprlandFocusedPlacement(presentation)
  if (hyprlandPlacement) return hyprlandPlacement
  return {
    bounds: fitWindowBounds(
      { height: presentation.height, width: presentation.width },
      getPreferredDisplay(window)
    ),
  }
}

function getPreferredDisplay(window: BrowserWindow) {
  const hyprlandDisplay = getHyprlandFocusedDisplay()
  if (hyprlandDisplay) return hyprlandDisplay
  if (window.isVisible()) return screen.getDisplayMatching(window.getBounds())
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

function setHyprlandOnboardingWindow(
  presentation: WindowPresentation,
  floating: boolean,
  placement?: HyprlandPlacement
) {
  if (process.platform !== "linux") return
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return
  hyprlandOnboardingFloating = floating
  const token = ++hyprlandPresentationToken
  for (const delay of presentationRetryDelaysMs)
    setTimeout(() => {
      void applyHyprlandWindowPresentation(
        presentation,
        floating,
        token,
        placement
      )
    }, delay)
}

async function applyHyprlandWindowPresentation(
  presentation: WindowPresentation,
  floating: boolean,
  token: number,
  placement?: HyprlandPlacement
) {
  if (token !== hyprlandPresentationToken) return
  if (!(await hasHyprlandWindow(presentation.title))) return
  if (floating && placement?.workspace !== undefined)
    await dispatchHyprland(
      hyprlandMoveToWorkspaceDispatcher(presentation.title, placement.workspace)
    )
  if (!(await dispatchHyprland(hyprlandFocusWindowDispatcher(presentation.title))))
    return
  if (token !== hyprlandPresentationToken) return
  await dispatchHyprland(
    `hl.dsp.window.float({ action = "${floating ? "set" : "unset"}" })`
  )
  if (floating && placement && token === hyprlandPresentationToken)
    await dispatchHyprland(
      hyprlandMoveWindowDispatcher(
        presentation.title,
        placement.hyprlandBounds ?? placement.bounds
      )
    )
  if (floating && token === hyprlandPresentationToken)
    await dispatchHyprland(hyprlandResizeWindowDispatcher(presentation))
}

function hyprlandFocusWindowDispatcher(title: string) {
  return `hl.dsp.focus({ window = "title:^(${escapedHyprlandRegex(title)})$" })`
}

function hyprlandMoveToWorkspaceDispatcher(
  title: string,
  workspace: number | string
) {
  return `hl.dsp.window.move({ workspace = ${hyprlandWorkspaceValue(workspace)}, follow = false, window = "${hyprlandTitleSelector(title)}" })`
}

function hyprlandMoveWindowDispatcher(title: string, bounds: WindowBounds) {
  return `hl.dsp.window.move({ x = ${bounds.x}, y = ${bounds.y}, "exact", window = "${hyprlandTitleSelector(title)}" })`
}

function hyprlandResizeWindowDispatcher(presentation: WindowPresentation) {
  return `hl.dsp.window.resize({ x = ${presentation.width}, y = ${presentation.height}, "exact", window = "${hyprlandTitleSelector(presentation.title)}" })`
}

function getHyprlandFocusedPlacement(
  presentation: WindowPresentation
): HyprlandPlacement | undefined {
  const monitor = getHyprlandFocusedMonitor()
  if (!monitor) return undefined
  const area = hyprlandMonitorWorkArea(monitor)
  if (!area) return undefined
  const localArea = hyprlandMonitorLocalWorkArea(monitor)
  const bounds = centerBoundsInArea(
    { height: presentation.height, width: presentation.width },
    area
  )
  const hyprlandBounds = localArea
    ? centerBoundsInArea(
        { height: presentation.height, width: presentation.width },
        localArea
      )
    : undefined
  const workspace = hyprlandMonitorWorkspace(monitor)
  return { bounds, hyprlandBounds, workspace }
}

function getHyprlandFocusedDisplay() {
  const monitor = getHyprlandFocusedMonitor()
  const area = monitor ? hyprlandMonitorWorkArea(monitor) : undefined
  if (!area) return undefined
  return screen.getDisplayNearestPoint({
    x: area.x + Math.round(area.width / 2),
    y: area.y + Math.round(area.height / 2),
  })
}

function getHyprlandFocusedMonitor() {
  if (process.platform !== "linux") return undefined
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return undefined
  const output = execFileOutputSync("hyprctl", ["monitors", "-j"])
  if (output === null) return undefined
  try {
    const monitors = JSON.parse(output)
    if (!Array.isArray(monitors)) return undefined
    return monitors.find((monitor) => hyprlandMonitorFocused(monitor))
  } catch {
    return undefined
  }
}

function hyprlandMonitorFocused(monitor: unknown) {
  if (!monitor || typeof monitor !== "object") return false
  return (monitor as Record<string, unknown>).focused === true
}

function hyprlandMonitorWorkArea(monitor: unknown): WindowBounds | undefined {
  const frame = hyprlandMonitorFrame(monitor)
  if (!frame) return undefined
  return {
    height: frame.height,
    width: frame.width,
    x: frame.x,
    y: frame.y,
  }
}

function hyprlandMonitorLocalWorkArea(
  monitor: unknown
): WindowBounds | undefined {
  const frame = hyprlandMonitorFrame(monitor)
  if (!frame) return undefined
  return {
    height: frame.height,
    width: frame.width,
    x: frame.left,
    y: frame.top,
  }
}

function hyprlandMonitorFrame(monitor: unknown) {
  if (!monitor || typeof monitor !== "object") return undefined
  const record = monitor as Record<string, unknown>
  const x = numberValue(record.x)
  const y = numberValue(record.y)
  const width = numberValue(record.width)
  const height = numberValue(record.height)
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined
  )
    return undefined
  const reserved = Array.isArray(record.reserved) ? record.reserved : []
  const left = numberValue(reserved[0]) ?? 0
  const top = numberValue(reserved[1]) ?? 0
  const right = numberValue(reserved[2]) ?? 0
  const bottom = numberValue(reserved[3]) ?? 0
  return {
    height: Math.max(1, height - top - bottom),
    left,
    top,
    width: Math.max(1, width - left - right),
    x: x + left,
    y: y + top,
  }
}

function centerBoundsInArea(
  bounds: { height: number; width: number },
  area: WindowBounds
) {
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  const x = area.x + Math.round((area.width - width) / 2)
  const y = area.y + Math.round((area.height - height) / 2)
  return { height, width, x, y }
}

function hyprlandMonitorWorkspace(monitor: unknown) {
  if (!monitor || typeof monitor !== "object") return undefined
  const activeWorkspace = (monitor as Record<string, unknown>).activeWorkspace
  if (!activeWorkspace || typeof activeWorkspace !== "object") return undefined
  const record = activeWorkspace as Record<string, unknown>
  const id = numberValue(record.id)
  if (id !== undefined) return id
  return typeof record.name === "string" ? record.name : undefined
}

async function hasHyprlandWindow(title: string) {
  const output = await execFileOutput("hyprctl", ["clients", "-j"])
  if (output === null) return false
  try {
    const clients = JSON.parse(output)
    return (
      Array.isArray(clients) &&
      clients.some((client) => hyprlandClientTitle(client) === title)
    )
  } catch {
    return false
  }
}

function hyprlandClientTitle(client: unknown) {
  if (!client || typeof client !== "object") return undefined
  return (client as Record<string, unknown>).title
}

async function dispatchHyprland(dispatcher: string) {
  return (await execFileOutput("hyprctl", ["dispatch", dispatcher])) !== null
}

function execFileOutputSync(command: string, args: string[]) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      timeout: 500,
    })
  } catch {
    return null
  }
}

function execFileOutput(command: string, args: string[]) {
  return new Promise<string | null>((resolve) => {
    execFile(command, args, (error, stdout) => {
      resolve(error ? null : String(stdout))
    })
  })
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function hyprlandWorkspaceValue(workspace: number | string) {
  if (typeof workspace === "number") return String(workspace)
  const numericWorkspace = Number(workspace)
  if (Number.isInteger(numericWorkspace)) return String(numericWorkspace)
  return `"${escapedLuaString(workspace)}"`
}

function hyprlandTitleSelector(title: string) {
  return `title:^(${escapedHyprlandRegex(title)})$`
}

function escapedLuaString(value: string) {
  return value.replace(/[\\"]/g, "\\$&")
}

function escapedHyprlandRegex(value: string) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")
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
