import { app, BrowserWindow, ipcMain } from "electron";
import electronUpdater from "electron-updater";
import type { ProgressInfo, UpdateInfo } from "electron-updater";

const { autoUpdater } = electronUpdater;

export type DesktopUpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error"
  | "unsupported";

export type DesktopUpdateStatus = {
  currentVersion: string;
  error?: string;
  latestVersion?: string;
  phase: DesktopUpdatePhase;
  progress?: number;
  reason?: string;
  releaseDate?: string;
  releaseNotes?: string;
};

type DesktopUpdateOptions = {
  beforeInstall(): Promise<void>;
};

let status: DesktopUpdateStatus = initialStatus();
let configured = false;

export function registerDesktopUpdateIpcHandlers(
  options: DesktopUpdateOptions,
) {
  configureUpdater();

  ipcMain.handle("updates:get-status", () => status);
  ipcMain.handle("updates:check", async () => {
    await checkForUpdates();
    return status;
  });
  ipcMain.handle("updates:download", async () => {
    await downloadUpdate();
    return status;
  });
  ipcMain.handle("updates:install", async () => {
    await installUpdate(options);
    return status;
  });
}

export function checkForUpdatesOnStartup() {
  if (!isUpdaterSupported()) return;
  setTimeout(() => {
    void checkForUpdates();
  }, 2_000);
}

function configureUpdater() {
  if (configured) return;
  configured = true;
  if (!isUpdaterSupported()) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => {
    setStatus({ ...baseStatus(), phase: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    setStatus(updateStatus("available", info));
  });

  autoUpdater.on("update-not-available", (info) => {
    setStatus(updateStatus("not-available", info));
  });

  autoUpdater.on("download-progress", (progress) => {
    setStatus(downloadStatus(progress));
  });

  autoUpdater.on("update-downloaded", (info) => {
    setStatus(updateStatus("downloaded", info));
  });

  autoUpdater.on("error", (error) => {
    setStatus({ ...baseStatus(), error: errorMessage(error), phase: "error" });
  });
}

async function checkForUpdates() {
  if (!isUpdaterSupported()) {
    setStatus(unsupportedStatus());
    return;
  }
  if (status.phase === "checking" || status.phase === "downloading") return;

  setStatus({ ...baseStatus(), phase: "checking" });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    setStatus({ ...baseStatus(), error: errorMessage(error), phase: "error" });
  }
}

async function downloadUpdate() {
  if (!isUpdaterSupported()) {
    setStatus(unsupportedStatus());
    return;
  }
  if (status.phase === "downloading" || status.phase === "downloaded") return;
  if (status.phase !== "available") return;

  setStatus({ ...status, phase: "downloading", progress: 0 });
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    setStatus({ ...baseStatus(), error: errorMessage(error), phase: "error" });
  }
}

async function installUpdate(options: DesktopUpdateOptions) {
  if (status.phase !== "downloaded") return;
  await options.beforeInstall();
  autoUpdater.quitAndInstall(false, true);
}

function initialStatus(): DesktopUpdateStatus {
  if (!isUpdaterSupported()) return unsupportedStatus();
  return baseStatus();
}

function unsupportedStatus(): DesktopUpdateStatus {
  return {
    ...baseStatus(),
    phase: "unsupported",
    reason: app.isPackaged
      ? "Updates are unavailable for this package."
      : "Updates are unavailable in development.",
  };
}

function baseStatus(): DesktopUpdateStatus {
  return {
    currentVersion: app.getVersion(),
    phase: "idle",
  };
}

function updateStatus(
  phase: DesktopUpdatePhase,
  info: UpdateInfo,
): DesktopUpdateStatus {
  return {
    ...baseStatus(),
    latestVersion: info.version,
    phase,
    releaseDate: info.releaseDate,
    releaseNotes: releaseNotes(info.releaseNotes),
  };
}

function downloadStatus(progress: ProgressInfo): DesktopUpdateStatus {
  return {
    ...status,
    phase: "downloading",
    progress: progress.percent,
  };
}

function releaseNotes(value: UpdateInfo["releaseNotes"]) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  return value
    .map((note) => note.note)
    .filter(Boolean)
    .join("\n\n");
}

function isUpdaterSupported() {
  return app.isPackaged;
}

function setStatus(nextStatus: DesktopUpdateStatus) {
  status = nextStatus;
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send("updates:status", status);
  });
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}
