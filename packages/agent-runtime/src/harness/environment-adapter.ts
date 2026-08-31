import { resolve } from "node:path";
import type { WorkspaceFiles } from "./workspace-files.js";

export class EnvironmentAdapter {
  private readonly files: WorkspaceFiles;
  private readonly platform: NodeJS.Platform;

  constructor(
    files: WorkspaceFiles,
    platform: NodeJS.Platform = process.platform,
  ) {
    this.files = files;
    this.platform = platform;
  }

  command(command: string) {
    if (this.platform === "win32")
      return { executable: "cmd.exe", args: ["/d", "/s", "/c", command] };
    return {
      executable: "/bin/bash",
      args: ["-o", "pipefail", "-lc", command],
    };
  }

  async cwd(path = ".") {
    const normalized = this.files.normalizePath(path);
    const profile = await this.files.pathProfile(normalized);
    if (!profile.directory)
      throw new Error(`${normalized} is not a directory.`);
    return resolve(this.files.root, normalized);
  }

  target() {
    if (this.platform === "darwin") return "macos-native" as const;
    if (this.platform === "win32") return "windows-native" as const;
    return "linux-native" as const;
  }
}
