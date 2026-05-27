import { cpSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const source = join(packageRoot, "src", "prompt")
const target = join(packageRoot, "dist", "prompt")

rmSync(target, { force: true, recursive: true })
cpSync(source, target, { recursive: true })
