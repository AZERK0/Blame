import { appendFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "./env-files.mjs";
import { loadPublishedRuntimeManifest } from "./runtime-manifest.mjs";

export async function verifyPublishedRuntime(version, request = fetch) {
  const manifest = await loadPublishedRuntimeManifest(version, { requireWindowsPrebuiltArchitecture: "amd64" });
  for (const [platform, architectures] of Object.entries({ windows: ["amd64", "arm64"], macos: ["x86_64", "aarch64"] })) {
    for (const architecture of architectures) {
      const artifact = manifest.artifacts?.[platform]?.[architecture];
      if (!artifact?.url || !/^[a-f0-9]{64}$/i.test(artifact.sha256 ?? ""))
        throw new Error(`Runtime v${version} is missing a verified ${platform}/${architecture} artifact`);
      const response = await request(artifact.url, { method: "HEAD", signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Runtime v${version} ${platform}/${architecture} returned HTTP ${response.status}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await loadEnvFiles(process.cwd());
  const source = JSON.parse(await readFile(new URL("../packages/desktop/resources/runtime/windows/manifest.json", import.meta.url), "utf8"));
  const version = process.env.BLAME_RUNTIME_VERSION || String(source.runtimeVersion);
  await verifyPublishedRuntime(version);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `runtime_version=${version}\n`);
  console.log(`Runtime v${version}: all four published artifacts are available`);
}
