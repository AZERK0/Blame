import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import contextMenu from "electron-context-menu"
import windowState from "electron-window-state"
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron"
import { registerAgentIpcHandlers, shutdownAgentRuntime } from "./agent-ipc"
import { destroyAllPreviewBrowsers, registerPreviewBrowserIpcHandlers } from "./preview-browser-ipc"
import { registerTerminalIpcHandlers, shutdownTerminalSessions } from "./terminal-ipc"
import { registerWorkspaceIpcHandlers, shutdownWorkspaceProcesses } from "./workspace-ipc"

contextMenu({ showLookUpSelection: false, showSaveImageAs: true, showSearchWithGoogle: false })

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const shutdownTimeoutMs = 4_000

try {
  process.chdir(homedir())
} catch {}

app.setName("Blame")
app.setAppUserModelId("dev.blame.desktop")
app.setPath("userData", join(app.getPath("appData"), "dev.blame.desktop"))

let mainWindow: BrowserWindow | undefined
let shutdownPromise: Promise<void> | undefined
let quitAfterShutdown = false

void app.whenReady().then(() => {
  registerIpcHandlers()
  registerAgentIpcHandlers()
  registerPreviewBrowserIpcHandlers()
  registerTerminalIpcHandlers()
  registerWorkspaceIpcHandlers()
  mainWindow = createMainWindow()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
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
  const state = windowState({
    defaultHeight: 900,
    defaultWidth: 1440,
  })
  const window = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    show: false,
    title: "Blame",
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(currentDirectory, "../preload/index.js"),
      sandbox: true,
    },
  })

  state.manage(window)
  loadRenderer(window)
  window.once("ready-to-show", () => window.show())
  return window
}

function loadRenderer(window: BrowserWindow) {
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
    return
  }
  void window.loadFile(join(currentDirectory, "../renderer/index.html"))
}

function registerIpcHandlers() {
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
