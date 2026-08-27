import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const desktopRoot = resolve(import.meta.dirname, "..");
const appImage = await resolveAppImage(process.argv[2]);
const configRoot = await mkdtemp(join(tmpdir(), "blame-appimage-config-"));

try {
  const result = await runAppImage(appImage, configRoot);
  process.exitCode = result;
} finally {
  await rm(configRoot, { force: true, recursive: true });
}

async function resolveAppImage(argument) {
  if (argument) {
    const path = resolve(argument);
    await access(path);
    return path;
  }
  const names = (await readdir(join(desktopRoot, "dist")))
    .filter((name) => name.endsWith(".AppImage"))
    .sort();
  const selected = names.at(-1);
  if (!selected)
    throw new Error("No packaged AppImage was found in desktop/dist");
  return join(desktopRoot, "dist", selected);
}

function runAppImage(appImage, configRoot) {
  return new Promise((resolveResult, reject) => {
    const child = spawn("xvfb-run", ["-a", appImage, "--no-sandbox"], {
      env: {
        ...process.env,
        BLAME_APPIMAGE_RUN_TASK_SMOKE: "true",
        XDG_CONFIG_HOME: configRoot,
      },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal)
        reject(new Error(`${basename(appImage)} exited with ${signal}`));
      else resolveResult(code ?? 1);
    });
  });
}
