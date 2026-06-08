import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, type BrowserWindow } from "electron";

type ConsoleMethod = "debug" | "error" | "info" | "log" | "warn";

const consoleMethods: ConsoleMethod[] = [
  "debug",
  "error",
  "info",
  "log",
  "warn",
];
const originalConsole = new Map<ConsoleMethod, (...data: unknown[]) => void>();

export function registerLiveLogCapture() {
  for (const method of consoleMethods) {
    originalConsole.set(method, console[method]);
    console[method] = (...data: unknown[]) => {
      appendLiveLog(method, data);
      originalConsole.get(method)?.(...data);
    };
  }

  process.on("uncaughtException", (error) => {
    appendLiveLog("uncaughtException", [error]);
  });

  process.on("unhandledRejection", (reason) => {
    appendLiveLog("unhandledRejection", [reason]);
  });

  process.on("warning", (warning) => {
    appendLiveLog("warning", [warning]);
  });
}

export function attachLiveLogWindow(window: BrowserWindow) {
  window.webContents.on(
    "console-message",
    (_event, level, message, line, source) => {
      appendLiveLog("renderer", [`level=${level}`, source, line, message]);
    },
  );

  window.webContents.on("render-process-gone", (_event, details) => {
    appendLiveLog("renderer-process-gone", [details]);
  });
}

function appendLiveLog(scope: string, data: unknown[]) {
  try {
    const line = `[${new Date().toISOString()}] [${scope}] ${data.map(formatLogValue).join(" ")}\n`;
    appendFileSync(liveLogPath(), line, "utf8");
  } catch {}
}

function liveLogPath() {
  const path = join(app.getPath("userData"), "logs", "blame-live.log");
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

function formatLogValue(value: unknown) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
