import { cp, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const rootDir = resolve(desktopDir, "../..")
const stagingDir = await mkdtemp(join(stagingParentDir(), "blame-desktop-package-"))
const deployDir = process.platform === "win32" ? basename(stagingDir) : stagingDir
const packageArgs = process.argv.slice(2)
const args = packageArgs[0] === "--" ? packageArgs.slice(1) : packageArgs

try {
  await run("pnpm", ["--filter", "@blame/desktop", "deploy", "--prod", "--legacy", deployDir], rootDir)
  await rm(join(stagingDir, "out"), { force: true, recursive: true })
  await cp(join(desktopDir, "out"), join(stagingDir, "out"), { recursive: true })
  await run("pnpm", ["exec", "electron-builder", "--projectDir", stagingDir, "--config", join(stagingDir, "electron-builder.config.ts"), ...args], rootDir)
  await rm(join(desktopDir, "dist"), { force: true, recursive: true })
  await cp(join(stagingDir, "dist"), join(desktopDir, "dist"), { recursive: true })
} finally {
  await rm(stagingDir, { force: true, recursive: true })
}

function run(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, env: process.env, shell: process.platform === "win32", stdio: "inherit" })
    child.once("error", rejectRun)
    child.once("exit", (code) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${command} ${args.join(" ")} exited with ${code}`))
    })
  })
}

function stagingParentDir() {
  if (process.platform === "win32") return rootDir
  return tmpdir()
}
