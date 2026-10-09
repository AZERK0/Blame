import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

const campaign = resolve(process.argv[2]);
const analysis = JSON.parse(await readFile(join(campaign, "analysis.json"), "utf8"));
const rows = [];
for (const trial of analysis.rows.filter((row) => row.id === "stable-pagination")) {
  const source = await readFile(join(campaign, trial.name, "workspace/src/pagination.ts"), "utf8");
  const cases = [
    { input: [
      { id: "older", published: true, createdAt: "2026-01-01T12:00:00+02:00" },
      { id: "newer", published: true, createdAt: "2026-01-01T10:30:00Z" },
    ], expected: ["newer", "older"] },
    { input: [
      { id: "b", published: true, createdAt: "2026-01-01T12:00:00+02:00" },
      { id: "a", published: true, createdAt: "2026-01-01T10:00:00Z" },
    ], expected: ["a", "b"] },
  ];
  const context = createContext({ exports: {}, cases, observations: [] });
  runInContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context, { timeout: 1000 });
  // Bound the exported invocation too, rather than only the module initializer.
  runInContext(`observations = cases.map(test => ({
    ids: exports.paginatePublishedProjects(test.input, 1, 10).map(project => project.id),
    expected: test.expected,
  }));`, context, { timeout: 1000 });
  const observations = JSON.parse(JSON.stringify(context.observations));
  rows.push({ name: trial.name, sourceSha256: createHash("sha256").update(source).digest("hex"),
    observations, passed: observations.every(({ ids, expected }) => JSON.stringify(ids) === JSON.stringify(expected)) });
}
const result = {
  selection: "Exploratory: selected after inspecting second-repetition sources; applied uniformly to every pagination solution. Original score unchanged, no solution repair or task-agent feedback.",
  criterion: "Chronological createdAt descending and id ascending for equal instants, including valid ISO timestamps with different UTC offsets.",
  ambiguity: "The task does not specify timestamp normalization; report this format-sensitive audit alongside the original frozen endpoint.",
  rows,
};
await writeFile(join(campaign, "pagination-replay.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
