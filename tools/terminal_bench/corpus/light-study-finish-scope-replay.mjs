import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Mechanical diagnosis only: no model, fixture solution retrieval or source repair.
const runtime = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const { LightWorkspace } = await import(pathToFileURL(join(runtime, "harness/light-workspace.js")));
const { executeLocalFinishTask } = await import(pathToFileURL(join(runtime, "harness/light-finish-service.js")));
const cases = [];
for (const unrelatedFailure of [false, true]) {
  const root = await mkdtemp(join(tmpdir(), "blame-finish-scope-"));
  try {
    await mkdir(join(root, "src"));
    await mkdir(join(root, "apps/web"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: {
      build: "node -e \"if (!require('node:fs').readFileSync('src/styles.css','utf8').includes('outline: 3px')) process.exit(1)\"",
    } }));
    await writeFile(join(root, "apps/web/package.json"), JSON.stringify({
      name: "corpus-web", scripts: { build: "node -e \"process.exit(9)\"" },
    }));
    await writeFile(join(root, "src/styles.css"), ".project-card { transition: transform 100ms; }\n");
    const taskContract = { session_id: "finish-scope-replay", effect_requirement: "source_change" };
    const workspace = new LightWorkspace(root, { sessionId: taskContract.session_id, taskContract });
    await workspace.readCode({ target: "src/styles.css", view: "raw" }, {});
    const edit = await workspace.editCode({ operations: [{ kind: "patch", path: "src/styles.css",
      patch: "*** Begin Patch\n*** Update File: src/styles.css\n@@\n .project-card { transition: transform 100ms; }\n+\n+.carousel-control:focus-visible { outline: 3px solid currentColor; outline-offset: 3px; }\n*** End Patch",
    }] }, {});
    const rootBuild = await workspace.runTask({ kind: "project", task: "build" }, {});
    const webBuild = unrelatedFailure
      ? await workspace.runTask({ kind: "project", task: "corpus-web:build" }, {}) : null;
    const finish = await executeLocalFinishTask({ workspaceRoot: root, taskContract,
      context: {}, input: { summary: "Requested CSS rule and root validation completed; unrelated pre-existing web failure reported when present." } });
    cases.push({ unrelatedFailure, edit, rootBuild, webBuild, finish });
  } finally { await rm(root, { recursive: true, force: true }); }
}
const result = { runtime, node: process.version,
  finishServiceSha256: createHash("sha256").update(await readFile(join(runtime, "harness/light-finish-service.js"))).digest("hex"),
  selection: "Known current diagnosis selected after ordinary campaign source inspection. Synthetic source/command-state replay on both frozen versions; not model success evidence or an implemented fix.",
  cases };
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(cases.map(({ unrelatedFailure, rootBuild, webBuild, finish }) => ({ unrelatedFailure,
  rootBuild: rootBuild.status, webBuild: webBuild?.status ?? null, finish: finish.status,
  message: finish.message ?? null, verified: finish.data?.notification?.verified ?? null }))));
