import { readdir, readFile } from "node:fs/promises"
import { dirname, extname, join, resolve } from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { loadEnvFiles, requiredEnv } from "./env-files.mjs"

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const desktopDir = join(rootDir, "packages/desktop")
const distDir = join(desktopDir, "dist")
const command = process.argv[2] ?? "help"
const args = process.argv.slice(3)

await loadEnvFiles(rootDir)

if (command === "build") await build(args)
else if (command === "deploy") await deploy()
else if (command === "release") {
  await build(args)
  await deploy()
} else {
  printHelp()
  process.exit(command === "help" ? 0 : 1)
}

async function build(platformArgs) {
  const packageArgs = platformArgs.length ? platformArgs : ["--linux", "--x64"]
  await run("pnpm", ["--filter", "@blame/desktop", "build"], rootDir)
  await run("pnpm", [
    "--filter",
    "@blame/desktop",
    "package",
    "--",
    ...packageArgs,
    "--publish",
    "never",
  ], rootDir)
}

async function deploy() {
  const host = requiredEnv("BLAME_DOWNLOAD_HOST")
  const user = requiredEnv("BLAME_DOWNLOAD_USER")
  const targetPath = requiredEnv("BLAME_DOWNLOAD_PATH")
  const port = process.env.BLAME_DOWNLOAD_SSH_PORT?.trim() || "22"
  const version = await releaseVersion()
  const files = await releaseFiles()

  if (files.length === 0) {
    throw new Error(`No release files found in ${distDir}`)
  }

  const sshArgs = sshCommand(port)
  const destination = `${user}@${host}`

  await run("ssh", [
    ...sshArgs,
    destination,
    `mkdir -p '${targetPath}/latest' '${targetPath}/releases/${version}'`,
  ], rootDir)

  await run("rsync", [
    "-az",
    "-e",
    ["ssh", ...sshArgs].join(" "),
    ...files,
    `${destination}:${targetPath}/latest/`,
  ], distDir)

  await run("rsync", [
    "-az",
    "-e",
    ["ssh", ...sshArgs].join(" "),
    ...files,
    `${destination}:${targetPath}/releases/${version}/`,
  ], distDir)
}

async function releaseFiles() {
  const entries = await readdir(distDir)
  return entries.filter(isReleaseFile)
}

function isReleaseFile(file) {
  if (file.startsWith("latest") && file.endsWith(".yml")) return true
  if (file.endsWith(".blockmap")) return true
  return [".AppImage", ".deb", ".dmg", ".exe", ".rpm", ".zip"].includes(extname(file))
}

async function releaseVersion() {
  const envVersion = process.env.BLAME_VERSION?.trim()
  if (envVersion) return envVersion

  const packageJson = JSON.parse(await readFile(join(desktopDir, "package.json"), "utf8"))
  return packageJson.version
}

function sshCommand(port) {
  const args = ["-p", port]
  const keyPath = process.env.BLAME_DOWNLOAD_SSH_KEY_PATH?.trim()
  if (keyPath) args.push("-i", keyPath)
  return args
}

function run(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: process.platform === "win32",
      stdio: "inherit",
    })
    child.once("error", rejectRun)
    child.once("exit", (code) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${command} ${args.join(" ")} exited with ${code}`))
    })
  })
}

function printHelp() {
  console.log("Usage: node scripts/desktop-release.mjs <build|deploy|release> [electron-builder args]")
}
