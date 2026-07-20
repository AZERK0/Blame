export type MainWindowRole = "compact" | "workspace"

export type MainWindowPresentation = {
  height: number
  minHeight: number
  minWidth: number
  resizable: boolean
  title: string
  width: number
}

const compactWindowWidth = 900
const compactWindowHeight = 700
const workspaceWindowWidth = 1440
const workspaceWindowHeight = 900
const workspaceMinWindowWidth = 960
const workspaceMinWindowHeight = 640

export function mainWindowPresentation(
  appName: string,
  role: MainWindowRole
): MainWindowPresentation {
  if (role === "compact") {
    return {
      height: compactWindowHeight,
      minHeight: compactWindowHeight,
      minWidth: compactWindowWidth,
      resizable: false,
      title: `${appName} - Compact`,
      width: compactWindowWidth,
    }
  }

  return {
    height: workspaceWindowHeight,
    minHeight: workspaceMinWindowHeight,
    minWidth: workspaceMinWindowWidth,
    resizable: true,
    title: appName,
    width: workspaceWindowWidth,
  }
}

export function isMainWindowRole(value: unknown): value is MainWindowRole {
  return value === "compact" || value === "workspace"
}
