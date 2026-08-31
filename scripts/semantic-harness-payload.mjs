import { execFile } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agentRuntimeDir = join(rootDir, "packages/agent-runtime");
const agentRuntimeDist = join(agentRuntimeDir, "dist");
const payloadName = "blame-semantic-harness.tgz";
const payloadHarnessFiles = new Set([
  "code-intelligence.js",
  "command-policy.js",
  "component-symbols.js",
  "content-validation.js",
  "environment-adapter.js",
  "initial-task-briefing.js",
  "language-capabilities.js",
  "lexical-search.js",
  "light-aliases.js",
  "light-capabilities.js",
  "light-commit.js",
  "light-dependencies.js",
  "light-diagnostic.js",
  "light-edit.js",
  "light-executor.js",
  "light-finish-service.js",
  "light-identity.js",
  "light-patch.js",
  "light-task-runner.js",
  "light-workspace.js",
  "package-manager-runtime.js",
  "packaged-resource-path.js",
  "patch-symbol-attribution.js",
  "read-coverage.js",
  "semantic-harness-runner.js",
  "session-journal.js",
  "task-catalog.js",
  "workspace-files.js",
]);
const dependencyNames = [
  "@ast-grep/lang-bash",
  "@ast-grep/lang-c",
  "@ast-grep/lang-cpp",
  "@ast-grep/lang-csharp",
  "@ast-grep/lang-go",
  "@ast-grep/lang-java",
  "@ast-grep/lang-python",
  "@ast-grep/lang-rust",
  "@ast-grep/napi",
  "@cline/sdk",
  "@vscode/ripgrep",
  "diff",
  "execa",
  "fast-glob",
  "jsonc-parser",
  "npm",
  "pnpm",
  "proper-lockfile",
  "typescript",
  "write-file-atomic",
  "yarn",
];

export async function buildSemanticHarnessPayload({
  outputPaths,
  runtimeVersion,
}) {
  await access(join(agentRuntimeDist, "harness/semantic-harness-runner.js"));
  const agentPackage = JSON.parse(
    await readFile(join(agentRuntimeDir, "package.json"), "utf8"),
  );
  const staging = await mkdtemp(join(tmpdir(), "blame-semantic-harness-"));
  try {
    const harnessSource = join(agentRuntimeDist, "harness");
    await cp(harnessSource, join(staging, "harness"), {
      recursive: true,
      filter: (source) =>
        source === harnessSource || payloadHarnessFiles.has(basename(source)),
    });
    await cp(
      join(agentRuntimeDist, "security-secret-redaction.js"),
      join(staging, "security-secret-redaction.js"),
    );
    await writeFile(
      join(staging, "package.json"),
      `${JSON.stringify(
        {
          name: "@blame/semantic-harness-runtime",
          version: payloadVersion(runtimeVersion),
          private: true,
          type: "module",
          bin: {
            "blame-semantic-harness": "harness/semantic-harness-runner.js",
          },
          engines: { node: ">=22" },
          files: ["harness", "security-secret-redaction.js"],
          dependencies: Object.fromEntries(
            dependencyNames.map((name) => [
              name,
              agentPackage.dependencies[name],
            ]),
          ),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const packDirectory = join(staging, "packed");
    await mkdir(packDirectory);
    await execFileAsync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["pack", "--ignore-scripts", "--pack-destination", packDirectory],
      {
        cwd: staging,
        shell: process.platform === "win32",
      },
    );
    const archive = (await readdir(packDirectory)).find((file) =>
      file.endsWith(".tgz"),
    );
    if (!archive)
      throw new Error("Semantic harness npm pack produced no archive");
    for (const outputPath of outputPaths) {
      await mkdir(dirname(outputPath), { recursive: true });
      await rm(outputPath, { force: true });
      await cp(join(packDirectory, archive), outputPath);
    }
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
}

export async function prepareSemanticHarnessPayload(options) {
  await execFileAsync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["--filter", "@blame/agent-runtime", "build"],
    { cwd: rootDir },
  );
  await buildSemanticHarnessPayload(options);
}

export function semanticHarnessPayloadPath(runtimeRoot, platform) {
  return join(runtimeRoot, platform, "payloads", payloadName);
}

function payloadVersion(runtimeVersion) {
  const suffix = String(runtimeVersion).replace(/[^0-9A-Za-z-]/g, "-");
  return `0.0.0-${suffix || "development"}`;
}

async function runCli() {
  const args = process.argv.slice(2);
  const runtimeRootArg = valueArg(args, "--runtime-root");
  if (!runtimeRootArg) return false;
  const runtimeRoot = resolve(process.cwd(), runtimeRootArg);
  const manifest = JSON.parse(
    await readFile(join(runtimeRoot, "macos/manifest.json"), "utf8"),
  );
  await buildSemanticHarnessPayload({
    runtimeVersion: manifest.runtimeVersion,
    outputPaths: [
      semanticHarnessPayloadPath(runtimeRoot, "macos"),
      semanticHarnessPayloadPath(runtimeRoot, "windows"),
    ],
  });
  return true;
}

function valueArg(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!(await runCli())) {
    console.error(
      "Usage: node scripts/semantic-harness-payload.mjs --runtime-root <path>",
    );
    process.exitCode = 2;
  }
}
