import { createHash } from "node:crypto"
import { access } from "node:fs/promises"
import { delimiter } from "node:path"
import { readdir, readFile, mkdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import {
  loadEnvFiles,
  requiredEnv,
  text,
  upsertEnvValues,
} from "./env-files.mjs"
import {
  rootfsPublicBaseUrl,
  runtimeRootfsFileName,
} from "./windows-runtime-manifest.mjs"

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const desktopDir = join(rootDir, "packages/desktop")
const runtimeScript = join(
  desktopDir,
  "resources/runtime/windows/scripts/build-blame-wsl-rootfs.ps1",
)
const outputDir = join(desktopDir, "dist/runtime/windows")
const envFile = join(rootDir, ".env.local")
const architectures = ["amd64", "arm64"]
const command = process.argv[2] ?? "help"
const rawArgs = process.argv.slice(3)
const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs

await loadEnvFiles(rootDir)

if (command === "build") await buildRootfs()
else if (command === "deploy") await deployRootfs()
else if (command === "release") {
  await buildRootfs()
  await deployRootfs()
} else {
  printHelp()
  process.exit(command === "help" ? 0 : 1)
}

async function buildRootfs() {
  await mkdir(outputDir, { recursive: true })
  for (const architecture of selectedArchitectures()) {
    await buildArchitecture(architecture)
  }
}

async function buildArchitecture(architecture) {
  const runtimeVersion = requiredRuntimeVersion()
  const ubuntuRootfs = requiredUbuntuRootfs(architecture)
  const output = join(outputDir, runtimeRootfsFileName(architecture, runtimeVersion))
  const distroName = `BlameRuntimeBuild${architecture}`
  const powershell = await powershellCommand()
  await assertUsableRootfsPath(ubuntuRootfs, architecture)
  await run(powershell.command, [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    await powershell.path(runtimeScript),
    "-UbuntuRootfs",
    await powershell.path(ubuntuRootfs),
    "-Output",
    await powershell.path(output),
    "-RuntimeVersion",
    runtimeVersion,
    "-DistroName",
    distroName,
    "-Replace",
    ...keepDistroArgs(),
  ])
}

async function deployRootfs() {
  const files = await runtimeFiles()
  if (!files.length) throw new Error(`No runtime rootfs files found in ${outputDir}`)

  const remote = remoteSpec()
  const sshArgs = sshCommand()
  await createRemoteDirectories(remote, sshArgs)
  await uploadFiles(files, remote, sshArgs, "latest/runtime/windows")
  await uploadFiles(files, remote, sshArgs, `releases/${requiredEnv("BLAME_VERSION")}/runtime/windows`)
  await writeRuntimeEnv(files)
}

async function runtimeFiles() {
  const runtimeVersion = requiredRuntimeVersion()
  const expectedFiles = new Set(
    architectures.map((architecture) => runtimeRootfsFileName(architecture, runtimeVersion)),
  )
  const entries = await readdir(outputDir)
  return entries
    .filter((entry) => expectedFiles.has(entry))
    .map((entry) => join(outputDir, entry))
}

async function writeRuntimeEnv(files) {
  const runtimeVersion = requiredRuntimeVersion()
  const baseUrl = requiredRootfsPublicBaseUrl()
  const values = [["BLAME_RUNTIME_VERSION", runtimeVersion]]
  for (const file of files) {
    const architecture = architectureFromFile(file)
    if (!architecture) continue
    const name = envArch(architecture)
    values.push([`BLAME_RUNTIME_ROOTFS_${name}_URL`, `${baseUrl}/${runtimeRootfsFileName(architecture, runtimeVersion)}`])
    values.push([`BLAME_RUNTIME_ROOTFS_${name}_SHA256`, await sha256(file)])
  }
  await upsertEnvValues(envFile, values)
}

async function createRemoteDirectories(remote, sshArgs) {
  await run("ssh", [
    ...sshArgs,
    remote.destination,
    `mkdir -p '${remote.path}/latest/runtime/windows' '${remote.path}/releases/${requiredEnv("BLAME_VERSION")}/runtime/windows'`,
  ])
}

async function uploadFiles(files, remote, sshArgs, relativeTarget) {
  await run("rsync", [
    "-az",
    "-e",
    ["ssh", ...sshArgs].join(" "),
    ...files,
    `${remote.destination}:${remote.path}/${relativeTarget}/`,
  ])
}

function selectedArchitectures() {
  const explicit = valueArg("--arch")
  if (explicit) return explicit.split(",").map((item) => item.trim()).filter(Boolean)
  const configured = architectures.filter((architecture) => text(process.env[`BLAME_RUNTIME_UBUNTU_ROOTFS_${envArch(architecture)}`]))
  if (configured.length) return configured
  return [process.env.PROCESSOR_ARCHITECTURE === "ARM64" ? "arm64" : "amd64"]
}

function requiredUbuntuRootfs(architecture) {
  return requiredEnv(`BLAME_RUNTIME_UBUNTU_ROOTFS_${envArch(architecture)}`)
}

function requiredRuntimeVersion() {
  return requiredEnv("BLAME_RUNTIME_VERSION")
}

function requiredRootfsPublicBaseUrl() {
  const baseUrl = rootfsPublicBaseUrl()
  if (!baseUrl) throw new Error("BLAME_RUNTIME_ROOTFS_BASE_URL or BLAME_DOWNLOAD_BASE_URL is required")
  return baseUrl
}

function remoteSpec() {
  return {
    destination: `${requiredEnv("BLAME_DOWNLOAD_USER")}@${requiredEnv("BLAME_DOWNLOAD_HOST")}`,
    path: requiredEnv("BLAME_DOWNLOAD_PATH"),
  }
}

function sshCommand() {
  const values = ["-p", text(process.env.BLAME_DOWNLOAD_SSH_PORT) ?? "22"]
  const keyPath = text(process.env.BLAME_DOWNLOAD_SSH_KEY_PATH)
  if (keyPath) values.push("-i", keyPath)
  return values
}

async function powershellCommand() {
  if (process.platform === "win32") {
    return { command: "powershell.exe", path: passthroughPath }
  }

  if (await executableExists("powershell.exe")) {
    await assertExecutableExists("wsl.exe", "wsl.exe is required to build Windows runtime rootfs images.")
    await assertExecutableExists("wslpath", "wslpath is required when building from WSL.")
    return { command: "powershell.exe", path: windowsPath }
  }

  if (await executableExists("pwsh")) {
    await assertExecutableExists("wsl.exe", "wsl.exe is required to build Windows runtime rootfs images.")
    return { command: "pwsh", path: passthroughPath }
  }

  throw new Error(
    "Windows runtime rootfs build requires a Windows host with WSL2. Run this command from Windows PowerShell, or from WSL with powershell.exe and wsl.exe available. On plain Linux, build the rootfs on Windows first, then use pnpm deploy:windows-runtime.",
  )
}

async function assertUsableRootfsPath(path, architecture) {
  if (path.includes("\\path\\") || path.startsWith("/path/to/")) {
    throw new Error(`BLAME_RUNTIME_UBUNTU_ROOTFS_${envArch(architecture)} still points to an example path: ${path}`)
  }
  if (process.platform === "win32" || isWindowsPath(path)) return
  try {
    await access(path)
  } catch {
    throw new Error(`BLAME_RUNTIME_UBUNTU_ROOTFS_${envArch(architecture)} does not exist: ${path}`)
  }
}

async function assertExecutableExists(commandName, message) {
  if (await executableExists(commandName)) return
  throw new Error(message)
}

async function executableExists(commandName) {
  const candidates = executableCandidates(commandName)
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return true
  }
  return false
}

async function pathExists(path) {
  return access(path).then(
    () => true,
    () => false,
  )
}

function executableCandidates(commandName) {
  if (commandName.includes("/") || commandName.includes("\\")) return [commandName]
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((entry) => join(entry, commandName))
}

async function windowsPath(path) {
  if (isWindowsPath(path)) return path
  return (await output("wslpath", ["-w", path])).trim()
}

function passthroughPath(path) {
  return path
}

function isWindowsPath(path) {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")
}

function keepDistroArgs() {
  return args.includes("--keep-distro") ? ["-KeepDistro"] : []
}

function valueArg(name) {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  return args[index + 1]
}

function architectureFromFile(file) {
  return file.match(/blame-runtime-wsl-(amd64|arm64)-v/)?.[1]
}

function envArch(architecture) {
  return architecture.toUpperCase()
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex")
}

function run(commandName, commandArgs) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(commandName, commandArgs, {
      cwd: rootDir,
      env: process.env,
      shell: process.platform === "win32",
      stdio: "inherit",
    })
    child.once("error", rejectRun)
    child.once("exit", (code) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${commandName} ${commandArgs.join(" ")} exited with ${code}`))
    })
  })
}

function output(commandName, commandArgs) {
  return new Promise((resolveOutput, rejectOutput) => {
    const child = spawn(commandName, commandArgs, {
      cwd: rootDir,
      env: process.env,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.once("error", rejectOutput)
    child.once("exit", (code) => {
      if (code === 0) resolveOutput(stdout)
      else rejectOutput(new Error(`${commandName} ${commandArgs.join(" ")} exited with ${code}: ${stderr}`))
    })
  })
}

function printHelp() {
  console.log("Usage: node scripts/windows-runtime-rootfs.mjs <build|deploy|release> [--arch amd64,arm64] [--keep-distro]")
}
