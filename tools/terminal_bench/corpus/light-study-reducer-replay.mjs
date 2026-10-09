import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

const campaign = resolve(process.argv[2]);
const analysis = JSON.parse(await readFile(join(campaign, "analysis.json"), "utf8"));
const rows = [];
for (const trial of analysis.rows.filter((row) => row.id === "stale-save-reducer")) {
  const source = await readFile(join(campaign, trial.name, "workspace/src/project-reducer.ts"), "utf8");
  const context = createContext({ exports: {}, observations: {} });
  runInContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context, { timeout: 1000 });
  runInContext(`
    const reduce = exports.projectSaveReducer;
    const prior = Object.freeze({ title: "draft", savedTitle: "saved", status: "error", error: "old", activeRequestId: "old" });
    const started = reduce(prior, { type: "save_started", requestId: "current" });
    const active = Object.freeze({ title: "draft", savedTitle: "saved", status: "saving", error: "old", activeRequestId: "current" });
    const success = reduce(active, { type: "save_succeeded", requestId: "current" });
    const failure = reduce(active, { type: "save_failed", requestId: "current", message: "failed" });
    observations = {
      startedValues: started.activeRequestId === "current" && started.status === "saving" && started.error === undefined && started.title === "draft" && started.savedTitle === "saved",
      staleSuccessIdentity: reduce(active, { type: "save_succeeded", requestId: "old" }) === active,
      staleFailureIdentity: reduce(active, { type: "save_failed", requestId: "old", message: "stale" }) === active,
      successValues: success.status === "idle" && success.title === "draft" && success.savedTitle === "draft" && success.activeRequestId === undefined && success.error === undefined,
      failureValues: failure.status === "error" && failure.title === "saved" && failure.savedTitle === "saved" && failure.error === "failed" && failure.activeRequestId === undefined,
      inputsUnchanged: prior.error === "old" && prior.activeRequestId === "old" && active.title === "draft" && active.savedTitle === "saved" && active.activeRequestId === "current" && active.error === "old",
      startedErrorAbsent: !Object.hasOwn(started, "error"),
      successRequestAbsent: !Object.hasOwn(success, "activeRequestId"),
      successErrorAbsent: !Object.hasOwn(success, "error"),
      failureRequestAbsent: !Object.hasOwn(failure, "activeRequestId"),
    };
  `, context, { timeout: 1000 });
  const observations = JSON.parse(JSON.stringify(context.observations));
  const valueKeys = ["startedValues", "staleSuccessIdentity", "staleFailureIdentity", "successValues", "failureValues", "inputsUnchanged"];
  rows.push({ name: trial.name, sourceSha256: createHash("sha256").update(source).digest("hex"), observations,
    valueSemanticsPassed: valueKeys.every((key) => observations[key]),
    physicalAbsencePassed: Object.values(observations).every(Boolean) });
}
const result = {
  selection: "Exploratory post-outcome sensitivity after inspecting optional-property scorer failures; applied uniformly to all six solutions. Original score and audit unchanged, no task-agent feedback or source repair.",
  ambiguity: "The prompt requires clearing/removing optional error/request fields. Physical property absence and undefined values are reported separately; value-level success does not overwrite the original own-property criterion.",
  rows,
};
await writeFile(join(campaign, "reducer-replay.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
