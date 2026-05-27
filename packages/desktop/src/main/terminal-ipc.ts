import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { BrowserWindow, ipcMain } from "electron"

type TerminalSession = {
  id: string
  cwd: string
  process: ChildProcessWithoutNullStreams
}

const sessions = new Map<string, TerminalSession>()
const forceKillDelayMs = 1_500

export function registerTerminalIpcHandlers() {
  ipcMain.handle("terminal:start", (_event, input: { cwd: string }) => startTerminal(input.cwd))
  ipcMain.handle("terminal:write", (_event, input: { id: string; data: string }) => writeTerminal(input.id, input.data))
  ipcMain.handle("terminal:stop", (_event, id: string) => stopTerminal(id))
}

function startTerminal(cwd: string) {
  const directory = resolve(cwd)
  if (!existsSync(directory)) throw new Error("Terminal directory does not exist")

  const id = randomUUID()
  const child = spawn(process.env.SHELL ?? "/bin/bash", ["-l"], {
    cwd: directory,
    detached: process.platform !== "win32",
    env: process.env,
  })
  const session = { id, cwd: directory, process: child }
  sessions.set(id, session)

  child.stdout.on("data", (data: Buffer) => emitTerminalEvent(id, "stdout", data.toString()))
  child.stderr.on("data", (data: Buffer) => emitTerminalEvent(id, "stderr", data.toString()))
  child.on("exit", (code) => {
    sessions.delete(id)
    emitTerminalEvent(id, "exit", String(code ?? ""))
  })

  return { id, cwd: directory }
}

function writeTerminal(id: string, data: string) {
  const session = sessions.get(id)
  if (!session) return false
  return session.process.stdin.write(data)
}

function stopTerminal(id: string) {
  const session = sessions.get(id)
  if (!session) return false
  killChildProcess(session.process, "SIGTERM")
  sessions.delete(id)
  return true
}

export async function shutdownTerminalSessions() {
  const activeSessions = Array.from(sessions.values())
  sessions.clear()
  await Promise.all(activeSessions.map((session) => stopChildProcess(session.process)))
}

async function stopChildProcess(child: ChildProcessWithoutNullStreams) {
  killChildProcess(child, "SIGTERM")
  await waitForExit(child)
}

function waitForExit(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()

  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      killChildProcess(child, "SIGKILL")
      resolve()
    }, forceKillDelayMs)

    child.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function killChildProcess(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {}
  }
  child.kill(signal)
}

function emitTerminalEvent(id: string, type: "stdout" | "stderr" | "exit", data: string) {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(`terminal:event:${id}`, { id, type, data })
  })
}
