import { ipcMain } from "electron"
import type { DesktopBridgeGrant } from "./preview-runtime/cloud-preview-client"
import {
  capturePreviewBrowser,
  createPreviewBrowser,
  destroyPreviewBrowser,
  getPreviewDevtoolsTarget,
  loadPreviewBrowser,
  reloadPreviewBrowser,
  setPreviewBrowserBounds,
  setPreviewBrowserDevtoolsScope,
} from "./preview-browser/preview-browser-manager"

export { getPreviewDevtoolsTarget }
export {
  destroyAllPreviewBrowsers,
  enablePreviewDevtools,
} from "./preview-browser/preview-browser-manager"
export type { PreviewDevtoolsTarget } from "./preview-browser/preview-browser-manager"

export function registerPreviewBrowserIpcHandlers(options: {
  bridgeGrant?(sessionId: string): Promise<DesktopBridgeGrant>
} = {}) {
  ipcMain.handle("preview-browser:create", (event, input: { storageKey: string; previewSessionId?: string }) =>
    createPreviewBrowser(event, input, options))
  ipcMain.handle("preview-browser:load", (_event, input: { id: string; url: string }) =>
    loadPreviewBrowser(input))
  ipcMain.handle("preview-browser:set-bounds", (_event, input) => setPreviewBrowserBounds(input))
  ipcMain.handle("preview-browser:set-devtools-scope", (_event, input) =>
    setPreviewBrowserDevtoolsScope(input))
  ipcMain.handle("preview-browser:reload", (_event, input: { id: string }) => reloadPreviewBrowser(input))
  ipcMain.handle("preview-browser:destroy", (_event, input: { id: string }) => destroyPreviewBrowser(input.id))
  ipcMain.handle("preview-browser:capture", (_event, input: { id: string; size?: "full" | "thumbnail" }) =>
    capturePreviewBrowser(input.id, input.size ?? "full"))
}
