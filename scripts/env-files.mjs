import { createReadStream } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"

export async function loadEnvFiles(rootDir, files = [".env", ".env.local"]) {
  for (const file of files) {
    await loadEnvFile(join(rootDir, file))
  }
}

export async function loadEnvFile(file) {
  try {
    await mkdir(dirname(file), { recursive: true })
    const lines = createInterface({
      crlfDelay: Infinity,
      input: createReadStream(file),
    })

    for await (const line of lines) {
      const entry = envEntry(line)
      if (!entry || process.env[entry.name]) continue
      process.env[entry.name] = entry.value
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
}

export function requiredEnv(name) {
  const value = text(process.env[name])
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function text(value) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function envEntry(line) {
  const name = envName(line)
  if (!name) return undefined
  const separatorIndex = line.indexOf("=")
  const value = unquote(line.slice(separatorIndex + 1).trim())
  return { name, value }
}

function envName(line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith("#")) return undefined
  const separatorIndex = trimmed.indexOf("=")
  if (separatorIndex <= 0) return undefined
  return trimmed.slice(0, separatorIndex).trim()
}

function unquote(value) {
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1)
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1)
  return value
}
