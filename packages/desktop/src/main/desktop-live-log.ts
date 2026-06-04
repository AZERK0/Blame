import { appendFileSync, mkdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
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

export function openPackagedLiveLogTerminal() {
  if (!app.isPackaged || process.env.BLAME_LOG_TERMINAL === "0") return;

  const path = liveLogPath();
  appendLiveLog("main", [`Live log: ${path}`]);

  if (process.platform === "darwin") {
    openMacosTerminal(path);
    return;
  }

  if (process.platform === "win32") {
    openWindowsTerminal(path);
    return;
  }

  openLinuxTerminal(path);
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

function openMacosTerminal(path: string) {
  spawnDetached("osascript", [
    "-e",
    `tell application "Terminal" to do script "tail -n 200 -f ${shellQuote(path)}"`,
    "-e",
    `tell application "Terminal" to activate`,
  ]);
}

function openWindowsTerminal(path: string) {
  const escapedPath = path.replace(/'/g, "''");
  spawnDetached("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Start-Process powershell.exe -ArgumentList @('-NoExit','-Command','Get-Content -LiteralPath ''${escapedPath}'' -Wait -Tail 200')`,
  ]);
}

function openLinuxTerminal(path: string) {
  const command = `tail -n 200 -f ${shellQuote(path)}`;
  const terminals: Array<[string, string[]]> = [
    ["x-terminal-emulator", ["-e", "sh", "-lc", command]],
    ["gnome-terminal", ["--", "sh", "-lc", command]],
    ["konsole", ["--hold", "-e", "sh", "-lc", command]],
    ["kitty", ["sh", "-lc", command]],
    ["alacritty", ["-e", "sh", "-lc", command]],
    ["xterm", ["-e", "sh", "-lc", command]],
  ];

  for (const [terminal, args] of terminals) {
    if (!commandExists(terminal)) continue;
    if (spawnDetached(terminal, args)) return;
  }

  appendLiveLog("main", ["No supported terminal emulator found"]);
}

function spawnDetached(command: string, args: string[]) {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", () => undefined);
    child.unref();
    return true;
  } catch (error) {
    appendLiveLog("main", [error]);
    return false;
  }
}

function commandExists(command: string) {
  return (
    spawnSync("sh", ["-lc", `command -v ${shellQuote(command)}`], {
      stdio: "ignore",
    }).status === 0
  );
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
