import { resolve } from "node:path";
import { runtimeManagedPath } from "./workspace-runtime.ts";

export function terminalDirectory(cwd: string) {
  return runtimeManagedPath(cwd) ? cwd.replace(/\\/g, "/") : resolve(cwd);
}

export function terminalShell(cwd = "", platform = process.platform) {
  if (runtimeManagedPath(cwd, platform)) {
    return { args: ["-l"], command: "bash", runtime: true };
  }
  if (platform === "win32") {
    return {
      args: ["/d", "/q"],
      command: process.env.COMSPEC ?? "cmd.exe",
      runtime: false,
    };
  }
  return {
    args: ["-l"],
    command: process.env.SHELL ?? "/bin/bash",
    runtime: false,
  };
}
