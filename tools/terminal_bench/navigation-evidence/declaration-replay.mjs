// Zero-model differential replay. Frozen runtime roots are explicit inputs.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const repo = resolve(new URL("../../..", import.meta.url).pathname);
if (process.argv[2] === "worker") {
  const [runtime, root, specification, arm, repetition] = process.argv.slice(3);
  const { LightWorkspace } = await import(pathToFileURL(join(runtime, "dist/harness/light-workspace.js")));
  const { WorkspaceFiles } = await import(pathToFileURL(join(runtime, "dist/harness/workspace-files.js")));
  let reads = 0;
  const original = WorkspaceFiles.prototype.read;
  WorkspaceFiles.prototype.read = function (...args) { reads++; return original.apply(this, args); };
  const rows = [], cases = JSON.parse(await readFile(specification, "utf8"));
  for (const [index, entry] of cases.entries()) {
    const workspace = new LightWorkspace(root, { sessionId: `${arm}-${repetition}-${index}` });
    const before = reads, start = performance.now();
    const response = await workspace.searchCode({ query: entry.query, mode: entry.mode, ...(entry.scope ? { scope: entry.scope } : {}) });
    const elapsed = performance.now() - start, results = response.data?.results ?? [];
    const isExact = item => typeof item.qualifiedName === "string" &&
      (item.qualifiedName.toLowerCase() === entry.query.toLowerCase() || item.qualifiedName.split(".").at(-1)?.toLowerCase() === entry.query.toLowerCase());
    const exact = results.find(isExact);
    const row = { ...entry, arm, repetition: Number(repetition), index, response,
      exactFirst: Boolean(results[0] && isExact(results[0])), exactPresent: Boolean(exact),
      resultCount: results.length, responseBytes: Buffer.byteLength(JSON.stringify(response)),
      searchMs: elapsed, filesystemReadCount: reads - before,
      cacheProtocol: "Fresh process per arm/repetition; parser cache then shared in registered query order; new workspace session per query." };
    if (exact) {
      const content = await readFile(join(root, exact.path));
      const body = await workspace.readCode({ target: exact.alias, view: "symbol" }, {});
      row.exactRead = { status: body.status, responseBytes: Buffer.byteLength(JSON.stringify(body)),
        sourceUnchanged: sha(content) === sha(await readFile(join(root, exact.path))) };
    }
    rows.push(row);
  }
  process.stdout.write(JSON.stringify(rows));
} else {
  const [baseline, modified, output] = process.argv.slice(2).map(value => resolve(value));
  const protocol = JSON.parse(await readFile(join(output, "protocol.json"), "utf8"));
  const sensitivity = JSON.parse(await readFile(join(output, "latency-protocol.json"), "utf8"));
  const root = await mkdtemp(join(tmpdir(), "blame-declaration-replay-"));
  const rows = [], fixtureRoot = join(root, "lodash");
  try {
    await mkdir(fixtureRoot);
    const source = await readFile(join(repo, ".blame/research/scope-followup/upstreams/lodash/lodash.js"));
    await writeFile(join(fixtureRoot, "lodash.js"), source);
    const diagnosticCases = protocol.queries.flatMap(q => protocol.modes.map(mode => ({ ...q, mode })));
    const diagnosticFile = join(root, "queries.json");
    await writeFile(diagnosticFile, JSON.stringify(diagnosticCases));
    for (let repetition = 1; repetition <= protocol.repetitions; repetition++) {
      for (const arm of repetition % 2 ? ["baseline", "modified"] : ["modified", "baseline"]) {
        rows.push(...JSON.parse(execFileSync(process.execPath, [new URL(import.meta.url).pathname,
          "worker", arm === "baseline" ? baseline : modified, fixtureRoot, diagnosticFile, arm, String(repetition)],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120000 })));
      }
    }
    const dateRoot = join(root, "date-fns");
    await mkdir(dateRoot);
    execFileSync("tar", ["-xf", "-", "-C", dateRoot], { input: execFileSync("git", ["archive", "HEAD"],
      { cwd: join(repo, sensitivity.sourceRoot), maxBuffer: 32 * 1024 * 1024 }) });
    const latencyFile = join(root, "latency.json");
    await writeFile(latencyFile, JSON.stringify(sensitivity.queries));
    for (let repetition = 1; repetition <= sensitivity.repetitions; repetition++) {
      for (const arm of repetition % 2 ? ["modified", "baseline"] : ["baseline", "modified"]) {
        rows.push(...JSON.parse(execFileSync(process.execPath, [new URL(import.meta.url).pathname,
          "worker", arm === "baseline" ? baseline : modified, dateRoot, latencyFile, arm, String(repetition)],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120000 })));
      }
    }
    await writeFile(join(output, "replay.json"), JSON.stringify({ paidRequests: 0,
      protocolSha256: sha(await readFile(join(output, "protocol.json"))),
      sensitivityProtocolSha256: sha(await readFile(join(output, "latency-protocol.json"))),
      node: process.version, lodashSourceSha256: sha(source), rows }, null, 2) + "\n");
    console.log(JSON.stringify({ rows: rows.length, paidRequests: 0 }));
  } finally { await rm(root, { recursive: true, force: true }); }
}
