import { join } from "node:path";

export function desktopResourcePaths(applicationPath: string) {
  const outputPath = join(applicationPath, "out");
  return {
    agentRuntime: join(outputPath, "main/agent-runtime-process.js"),
    preload: join(outputPath, "preload/index.js"),
    renderer: join(outputPath, "renderer/index.html"),
  };
}
