import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnvFiles, text } from "./env-files.mjs"
import {
  runtimeClineSdkVersion,
  syncRuntimeSdkVersions,
} from "./runtime-sdk-version.mjs"

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const desktopDir = join(rootDir, "packages/desktop")
const runtimeRoot = join(desktopDir, "resources/runtime")
const windowsManifest = "windows/manifest.json"
const architectures = ["amd64", "arm64"]

export async function prepareRuntimeManifests(targetRuntimeRoot = runtimeRoot) {
  await syncRuntimeSdkVersions(targetRuntimeRoot)
  return prepareWindowsRuntimeManifest(targetRuntimeRoot)
}

export async function prepareWindowsRuntimeManifest(targetRuntimeRoot = runtimeRoot) {
  const manifestPath = join(targetRuntimeRoot, windowsManifest)
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  const runtimeVersion = runtimeVersionFor(manifest)
  manifest.runtimeVersion = runtimeVersion
  manifest.clineSdkVersion = await runtimeClineSdkVersion()
  manifest.rootfs = rootfsSpecs(manifest, runtimeVersion)
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  return manifest
}

export function runtimeRootfsFileName(architecture, runtimeVersion) {
  return `blame-runtime-wsl-${architecture}-v${runtimeVersion}.tar.gz`
}

export function rootfsPublicBaseUrl() {
  const explicitBaseUrl = text(process.env.BLAME_RUNTIME_ROOTFS_BASE_URL)
  if (explicitBaseUrl) return trimSlash(explicitBaseUrl)

  const downloadBaseUrl = text(process.env.BLAME_DOWNLOAD_BASE_URL)
  if (!downloadBaseUrl) return undefined

  const releaseVersion = text(process.env.BLAME_VERSION)
  const stableBaseUrl = releaseVersion
    ? downloadBaseUrl.replace(/\/latest\/?$/, `/releases/${releaseVersion}`)
    : downloadBaseUrl
  return `${trimSlash(stableBaseUrl)}/runtime/windows`
}

function rootfsSpecs(manifest, runtimeVersion) {
  return Object.fromEntries(
    architectures.map((architecture) => [
      architecture,
      rootfsSpec(manifest, architecture, runtimeVersion),
    ]),
  )
}

function rootfsSpec(manifest, architecture, runtimeVersion) {
  const existing = manifest.rootfs?.[architecture] ?? {}
  const sha256 = rootfsSha256(architecture, runtimeVersion)
  const explicitUrl = text(process.env[`BLAME_RUNTIME_ROOTFS_${envArch(architecture)}_URL`])
  const url = explicitUrl ?? derivedRootfsUrl(architecture, runtimeVersion, sha256)
  if (!url) return existing

  return {
    kind: "blame-prebaked",
    url,
    ...(sha256 ? { sha256 } : {}),
  }
}

function runtimeVersionFor(manifest) {
  return text(process.env.BLAME_RUNTIME_VERSION) ?? String(manifest.runtimeVersion)
}

function derivedRootfsUrl(architecture, runtimeVersion, enabled) {
  if (!enabled) return undefined

  const baseUrl = rootfsPublicBaseUrl()
  if (!baseUrl) return undefined
  return `${baseUrl}/${runtimeRootfsFileName(architecture, runtimeVersion)}`
}

function rootfsSha256(architecture, runtimeVersion) {
  const explicitSha = text(process.env[`BLAME_RUNTIME_ROOTFS_${envArch(architecture)}_SHA256`])
  if (explicitSha) return explicitSha

  return rootfsArtifactSha256(architecture, runtimeVersion)
}

function rootfsArtifactSha256(architecture, runtimeVersion) {
  try {
    const file = join(
      desktopDir,
      "dist/runtime/windows",
      runtimeRootfsFileName(architecture, runtimeVersion),
    )
    return createHash("sha256").update(readFileSync(file)).digest("hex")
  } catch {
    return undefined
  }
}

function envArch(architecture) {
  return architecture.toUpperCase()
}

function trimSlash(value) {
  return value.replace(/\/+$/, "")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await loadEnvFiles(rootDir)
  await prepareRuntimeManifests(process.argv[2] ? resolve(process.argv[2]) : runtimeRoot)
}
