import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type {
  MainWindowPresentation,
  MainWindowRole,
} from "./main-window-presentation"

const execFileAsync = promisify(execFile)
const clientLookupDelaysMs = [40, 180]
const commandTimeoutMs = 1_000

type HyprlandWindowInput = {
  presentation: MainWindowPresentation
  role: MainWindowRole
}

export function configureHyprlandWindow(input: HyprlandWindowInput) {
  if (!isHyprlandSession()) return
  void applyHyprlandWindowRole(input)
}

async function applyHyprlandWindowRole(input: HyprlandWindowInput) {
  for (const delayMs of clientLookupDelaysMs) {
    await wait(delayMs)
    const address = await findHyprlandWindowAddress(input.presentation.title)
    if (!address) continue
    await dispatchHyprlandWindowRole(input, address)
    return
  }
}

async function findHyprlandWindowAddress(title: string) {
  const output = await runHyprctl(["clients", "-j"])
  return output ? hyprlandWindowAddress(output, process.pid, title) : undefined
}

async function dispatchHyprlandWindowRole(
  input: HyprlandWindowInput,
  address: string
) {
  const currentCommands = hyprlandLuaDispatchers(input, address)
  if (await runHyprlandCommands(currentCommands)) return
  await runHyprlandCommands(hyprlandLegacyDispatchers(input, address))
}

async function runHyprlandCommands(commands: string[][]) {
  for (const command of commands) {
    if (!(await runHyprctl(command))) return false
  }
  return true
}

async function runHyprctl(argumentsList: string[]) {
  try {
    const result = await execFileAsync("hyprctl", argumentsList, {
      encoding: "utf8",
      timeout: commandTimeoutMs,
    })
    return result.stdout
  } catch {
    return
  }
}

function isHyprlandSession() {
  return (
    process.platform === "linux" && !!process.env.HYPRLAND_INSTANCE_SIGNATURE
  )
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

export function hyprlandWindowAddress(
  output: string,
  processId: number,
  title: string
) {
  const clients = parseHyprlandClients(output)
  const client = clients.find(
    (candidate) =>
      candidate.pid === processId &&
      (candidate.initialTitle === title || candidate.title === title)
  )
  return validHyprlandAddress(client?.address)
}

function parseHyprlandClients(output: string): Record<string, unknown>[] {
  try {
    const value = JSON.parse(output)
    return Array.isArray(value)
      ? value.filter((item) => !!item && typeof item === "object")
      : []
  } catch {
    return []
  }
}

function validHyprlandAddress(value: unknown) {
  return typeof value === "string" && /^0x[\da-f]+$/i.test(value)
    ? value
    : undefined
}

export function hyprlandLuaDispatchers(
  input: HyprlandWindowInput,
  address: string
) {
  const selector = `address:${address}`
  const floatAction = input.role === "compact" ? "enable" : "disable"
  const floatCommand = `hl.dsp.window.float({ action = "${floatAction}", window = "${selector}" })`
  if (input.role === "workspace") return [["dispatch", floatCommand]]
  const { height, width } = input.presentation
  return [
    ["dispatch", floatCommand],
    [
      "dispatch",
      `hl.dsp.window.resize({ x = ${width}, y = ${height}, window = "${selector}" })`,
    ],
    ["dispatch", `hl.dsp.window.center({ window = "${selector}" })`],
  ]
}

export function hyprlandLegacyDispatchers(
  input: HyprlandWindowInput,
  address: string
) {
  const selector = `address:${address}`
  if (input.role === "workspace") return [["dispatch", "settiled", selector]]
  const { height, width } = input.presentation
  return [
    ["dispatch", "setfloating", selector],
    ["dispatch", "resizewindowpixel", `exact ${width} ${height},${selector}`],
  ]
}
