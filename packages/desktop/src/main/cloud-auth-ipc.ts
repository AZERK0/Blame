import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import { CloudAuthCookieJar, sendCloudAuthRequest } from "./cloud-auth-request";

type CloudAuthIpcOptions = {
  mainWindow(): BrowserWindow | undefined;
  packaged: boolean;
};

export function registerCloudAuthIpcHandlers(options: CloudAuthIpcOptions) {
  const cookieJar = new CloudAuthCookieJar();
  ipcMain.handle("cloud-auth:request", (event, request) => {
    if (event.sender !== options.mainWindow()?.webContents) {
      throw new Error("Cloud authentication request was rejected.");
    }
    return sendCloudAuthRequest(request, {
      cookieJar,
      packaged: options.packaged,
    });
  });
}
