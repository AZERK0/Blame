import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const desktop = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
// Let pnpm build the complete dependency graph in topological order. A manual
// list misses new transitive packages while TypeScript still resolves their src.
const filters = Object.entries(desktop.dependencies)
  .filter(([, version]) => version.startsWith("workspace:"))
  .flatMap(([name]) => ["--filter", `${name}...`]);
if (!filters.length)
  throw new Error("Desktop has no workspace dependencies to build");
const child = spawn("pnpm", [...filters, "run", "build"], {
  cwd: fileURLToPath(new URL("../../../", import.meta.url)),
  shell: process.platform === "win32",
  stdio: "inherit",
});
child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
