import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import YAML from "yaml"

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const rootDir = resolve(desktopDir, "../..")
const workspaceFile = join(rootDir, "pnpm-workspace.yaml")
const stagingDir = await mkdtemp(join(stagingParentDir(), "blame-desktop-package-"))
const deployDir = process.platform === "win32" ? basename(stagingDir) : stagingDir
const packageArgs = process.argv.slice(2)
const args = packageArgs[0] === "--" ? packageArgs.slice(1) : packageArgs

try {
  await deployPackage(deployDir, args)
  await rm(join(stagingDir, "out"), { force: true, recursive: true })
  await cp(join(desktopDir, "out"), join(stagingDir, "out"), { recursive: true })
  await run("pnpm", ["exec", "electron-builder", "--projectDir", stagingDir, "--config", join(stagingDir, "electron-builder.config.ts"), ...args], rootDir, {
    ...process.env,
    JITI_FS_CACHE: "false",
  })
  await rm(join(desktopDir, "dist"), { force: true, recursive: true })
  await cp(join(stagingDir, "dist"), join(desktopDir, "dist"), { recursive: true })
} finally {
  await rm(stagingDir, { force: true, recursive: true })
}

async function deployPackage(targetDir, builderArgs) {
  const supportedArchitectures = windowsSupportedArchitectures(builderArgs)
  if (!supportedArchitectures) {
    await runDeploy(targetDir)
    return
  }

  const workspaceConfig = await readFile(workspaceFile, "utf8")
  const updatedConfig = YAML.parse(workspaceConfig)
  updatedConfig.supportedArchitectures = supportedArchitectures

  try {
    await writeFile(workspaceFile, YAML.stringify(updatedConfig), "utf8")
    await runDeploy(targetDir)
  } finally {
    await writeFile(workspaceFile, workspaceConfig, "utf8")
  }
}

function windowsSupportedArchitectures(builderArgs) {
  if (!builderArgs.some((arg) => arg === "--win" || arg === "win")) return undefined

  const cpu = []
  if (builderArgs.includes("--x64")) cpu.push("x64")
  if (builderArgs.includes("--arm64")) cpu.push("arm64")
  if (builderArgs.includes("--ia32")) cpu.push("ia32")

  return {
    cpu: cpu.length ? cpu : ["x64"],
    os: ["win32"],
  }
}

async function runDeploy(targetDir) {
  await run("pnpm", ["--filter", "@blame/desktop", "deploy", "--prod", "--legacy", targetDir], rootDir)
}

function run(command, args, cwd, env = process.env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, env, shell: process.platform === "win32", stdio: "inherit" })
    child.once("error", rejectRun)
    child.once("exit", (code) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${command} ${args.join(" ")} exited with ${code}`))
    })
  })
}

function stagingParentDir() {
  const customDir = process.env.BLAME_DESKTOP_PACKAGE_DIR?.trim()
  if (customDir) return resolve(customDir)
  if (process.platform === "darwin") return tmpdir()
  return rootDir
}
