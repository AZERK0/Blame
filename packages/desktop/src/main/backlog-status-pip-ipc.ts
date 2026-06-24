import {
  BrowserWindow,
  ipcMain,
  screen,
  type BrowserWindowConstructorOptions,
} from "electron"

const windowWidth = 360
const windowHeight = 600
const minWindowWidth = 320
const minWindowHeight = 360
const edgeMargin = 24
const statusPipView = "backlog-status-pip"

let statusPipWindow: BrowserWindow | undefined

export function registerBacklogStatusPipIpcHandlers(input: {
  mainWindow(): BrowserWindow | undefined
  preloadPath: string
  rendererFile: string
  rendererUrl?: string
}) {
  ipcMain.handle("backlog-status-pip:open", () => openStatusPipWindow(input))
  ipcMain.handle("backlog-status-pip:request", (_event, request) =>
    sendStatusPipRequest(input.mainWindow(), request)
  )
}

function openStatusPipWindow(input: {
  mainWindow(): BrowserWindow | undefined
  preloadPath: string
  rendererFile: string
  rendererUrl?: string
}) {
  if (statusPipWindow && !statusPipWindow.isDestroyed()) {
    showStatusPipWindow(statusPipWindow)
    return true
  }

  const window = new BrowserWindow(windowOptions(input.preloadPath))
  statusPipWindow = window
  window.setAspectRatio(0)
  window.on("closed", () => {
    if (statusPipWindow === window) statusPipWindow = undefined
  })
  loadStatusPipRenderer(window, input)
  window.once("ready-to-show", () => showStatusPipWindow(window))
  return true
}

function windowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  const bounds = defaultBounds()
  return {
    ...bounds,
    minHeight: minWindowHeight,
    minWidth: minWindowWidth,
    show: false,
    title: "Active User Stories",
    type: "toolbar",
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: "#0a0a0a",
    fullscreenable: false,
    maximizable: false,
    resizable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
    },
  }
}

function defaultBounds() {
  const area = screen.getPrimaryDisplay().workArea
  const width = Math.min(windowWidth, area.width)
  const height = Math.min(windowHeight, area.height)
  return {
    height,
    width,
    x: Math.max(area.x, area.x + area.width - width - edgeMargin),
    y: Math.min(area.y + edgeMargin, area.y + area.height - height),
  }
}

function loadStatusPipRenderer(
  window: BrowserWindow,
  input: {
    rendererFile: string
    rendererUrl?: string
  }
) {
  if (input.rendererUrl) {
    void window.loadURL(`${input.rendererUrl}?view=${statusPipView}`)
    return
  }
  void window.loadFile(input.rendererFile, {
    query: { view: statusPipView },
  })
}

function showStatusPipWindow(window: BrowserWindow) {
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function sendStatusPipRequest(
  window: BrowserWindow | undefined,
  request: unknown
) {
  if (!window || window.isDestroyed()) return false
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  window.webContents.send("backlog-status-pip:request", request)
  return true
}
