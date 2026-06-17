import { createReadStream } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
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

export async function upsertEnvValues(file, values) {
  const existing = await readEnvFile(file)
  const names = new Set(values.map(([name]) => name))
  const lines = existing
    .split(/\r?\n/)
    .filter((line) => !names.has(envName(line)))
    .filter((line, index, items) => line || index < items.length - 1)

  if (lines.length && lines.at(-1)) lines.push("")
  for (const [name, value] of values) lines.push(`${name}=${quoteEnvValue(value)}`)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${lines.join("\n")}\n`, "utf8")
}

async function readEnvFile(file) {
  try {
    return await readFile(file, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return ""
    throw error
  }
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

function quoteEnvValue(value) {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value
  return JSON.stringify(value)
}
