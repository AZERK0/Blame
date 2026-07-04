import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnvFiles, text } from "./env-files.mjs"

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const agentRuntimePackage = join(rootDir, "packages/agent-runtime/package.json")
const runtimeRoot = join(rootDir, "packages/desktop/resources/runtime")
const managedRuntimeManifests = ["macos/manifest.json", "windows/manifest.json"]

export async function syncRuntimeSdkVersions(targetRuntimeRoot = runtimeRoot) {
  const version = await runtimeClineSdkVersion()
  for (const manifest of managedRuntimeManifests) {
    await writeRuntimeManifestSdkVersion(join(targetRuntimeRoot, manifest), version)
  }
  return version
}

export async function runtimeClineSdkVersion() {
  const explicit = text(process.env.BLAME_CLINE_SDK_VERSION)
  if (explicit) return explicit
  const packageJson = JSON.parse(await readFile(agentRuntimePackage, "utf8"))
  const version = normalizePackageVersion(packageJson.dependencies?.["@cline/sdk"])
  if (!version) throw new Error("@cline/sdk dependency is missing from @blame/agent-runtime")
  return version
}

export function normalizePackageVersion(value) {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const exact = trimmed.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)
  return exact?.[0]
}

async function writeRuntimeManifestSdkVersion(path, version) {
  const manifest = JSON.parse(await readFile(path, "utf8"))
  manifest.clineSdkVersion = version
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await loadEnvFiles(rootDir)
  await syncRuntimeSdkVersions(process.argv[2] ? resolve(process.argv[2]) : runtimeRoot)
}
