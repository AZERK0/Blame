import { resolve } from "node:path"

export type DesktopAuthCallback = { code?: string; error?: string }

export function desktopProtocolClientArguments(
  isPackaged: boolean,
  executablePath: string,
  processArguments: string[]
): [] | [string, string[]] {
  const applicationPath = processArguments[1]
  if (isPackaged || !applicationPath) return []
  return [executablePath, [resolve(applicationPath)]]
}

export function desktopAuthCallback(
  value: string | undefined
): DesktopAuthCallback | undefined {
  if (!value) return undefined
  try {
    return parsedAuthCallback(new URL(value))
  } catch {
    return undefined
  }
}

function parsedAuthCallback(url: URL) {
  if (
    url.protocol !== "blame:" ||
    url.hostname !== "auth" ||
    url.pathname !== "/callback"
  ) {
    return undefined
  }
  const code = url.searchParams.get("code") ?? undefined
  const error = url.searchParams.get("error") ?? undefined
  if (code && validCode(code, url.searchParams.size)) return { code }
  if (error && validError(error, url.searchParams.size)) return { error }
  return undefined
}

function validCode(code: string, parameterCount: number) {
  return /^[A-Za-z0-9_-]{32,128}$/.test(code) && parameterCount === 1
}

function validError(error: string, parameterCount: number) {
  return /^[a-z_]{1,64}$/.test(error) && parameterCount === 1
}
