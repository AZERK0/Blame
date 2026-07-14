import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getBlameTelemetry, type TelemetrySeverity } from "@blame/telemetry";
import {
  app,
  type BrowserWindow,
  type RenderProcessGoneDetails,
} from "electron";
import {
  liveLogAttributes,
  rendererLogAttributes,
} from "./desktop-log-attributes";

type ConsoleMethod = "debug" | "error" | "info" | "log" | "warn";

const consoleMethods: ConsoleMethod[] = [
  "debug",
  "error",
  "info",
  "log",
  "warn",
];
const originalConsole = new Map<ConsoleMethod, (...data: unknown[]) => void>();
const telemetry = getBlameTelemetry();
const maximumLogBytes = 10 * 1024 * 1024;
const maximumPendingWrites = 1_000;
const retainedLogFiles = 3;
let currentLogBytes: number | undefined;
let pendingWrites = 0;
let writeQueue = Promise.resolve();

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
      appendRendererLog(level, message, line, source);
    },
  );

  window.webContents.on("render-process-gone", (_event, details) => {
    appendRendererProcessGone(details);
  });
}

function appendLiveLog(scope: string, data: unknown[]) {
  try {
    const eventName = eventNameForScope(scope);
    const severity = severityForScope(scope);
    recordLiveLog(severity, eventName, liveLogAttributes(data));
  } catch {}
}

function appendRendererLog(
  level: number,
  message: string,
  line: number,
  source: string,
) {
  const attributes = rendererLogAttributes(message, line, source);
  recordLiveLog(
    rendererSeverity(level),
    "blame.desktop.renderer.console",
    attributes,
  );
}

function appendRendererProcessGone(details: RenderProcessGoneDetails) {
  const severity = details.reason === "clean-exit" ? "info" : "error";
  const attributes = {
    "blame.process.exit_code": details.exitCode,
    "blame.process.reason": details.reason,
    ...(severity === "error" ? { "error.type": "RendererProcessGone" } : {}),
  };
  recordLiveLog(severity, "blame.desktop.renderer.process_gone", attributes);
}

function liveLogPath() {
  return join(app.getPath("userData"), "logs", "blame-live.log");
}

function recordLiveLog(
  severity: TelemetrySeverity,
  eventName: string,
  attributes: Record<string, unknown>,
) {
  try {
    writeLogRecord(telemetry.structuredLog(severity, eventName, attributes));
  } catch {}
  try {
    emitOperationalLog(severity, eventName, attributes);
  } catch {}
}

function writeLogRecord(record: Record<string, unknown>) {
  if (pendingWrites >= maximumPendingWrites) return;
  const line = `${JSON.stringify(record)}\n`;
  pendingWrites += 1;
  writeQueue = writeQueue
    .then(() => appendRotatingLog(line))
    .catch(() => undefined)
    .finally(() => {
      pendingWrites -= 1;
    });
}

export function flushLiveLogs() {
  return writeQueue;
}

async function appendRotatingLog(line: string) {
  const path = liveLogPath();
  await mkdir(dirname(path), { recursive: true });
  const lineBytes = Buffer.byteLength(line);
  const fileBytes = await currentLiveLogBytes(path);
  if (fileBytes + lineBytes > maximumLogBytes) await rotateLiveLogs(path);
  await appendFile(path, line, "utf8");
  currentLogBytes = (currentLogBytes ?? 0) + lineBytes;
}

async function currentLiveLogBytes(path: string) {
  if (currentLogBytes !== undefined) return currentLogBytes;
  try {
    currentLogBytes = (await stat(path)).size;
  } catch {
    currentLogBytes = 0;
  }
  return currentLogBytes;
}

async function rotateLiveLogs(path: string) {
  await rm(`${path}.${retainedLogFiles}`, { force: true });
  for (let index = retainedLogFiles - 1; index >= 1; index -= 1) {
    await moveLogFile(`${path}.${index}`, `${path}.${index + 1}`);
  }
  await moveLogFile(path, `${path}.1`);
  currentLogBytes = 0;
}

async function moveLogFile(source: string, destination: string) {
  try {
    await rm(destination, { force: true });
    await rename(source, destination);
  } catch {}
}

function emitOperationalLog(
  severity: TelemetrySeverity,
  eventName: string,
  attributes: Record<string, unknown>,
) {
  if (severity === "error" || severity === "warn") {
    telemetry.log(severity, eventName, attributes);
  }
}

function eventNameForScope(scope: string) {
  return `blame.desktop.${scope.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
}

function severityForScope(scope: string): TelemetrySeverity {
  if (scope === "debug") return "debug";
  if (scope.includes("error") || scope.includes("Exception")) return "error";
  if (scope === "warn" || scope === "warning") return "warn";
  return "info";
}

function rendererSeverity(level: number): TelemetrySeverity {
  if (level >= 3) return "error";
  if (level === 2) return "warn";
  if (level === 0) return "debug";
  return "info";
}
