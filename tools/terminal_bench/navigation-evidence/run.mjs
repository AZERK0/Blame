import { createHash } from "node:crypto";
import { spawn, execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, symlink, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { performance } from "node:perf_hooks";
import { reconcileUsage } from "../corpus/light-study-accounting.mjs";
import { repo, work, studyFor } from "./campaign-paths.mjs";
import { getProviderCollectionSync } from "../../../packages/agent-runtime/node_modules/@cline/llms/dist/index.js";

const panel = process.argv[3];
if (!["f18","f19","f20","f21","f22","f23"].includes(panel)) throw new Error("Specify a registered F18--F23 panel");
const study = studyFor(panel);
const campaign = join(work, panel);
const protocol = JSON.parse(await readFile(join(study, "protocol.json"), "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + "\n");
const git = (args, cwd = repo, extraEnv = {}) => execFileSync("git", args, { cwd, env:{...process.env,...extraEnv}, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
async function tree(path) {
  const hash = createHash("sha256");
  for (const entry of (await readdir(path, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)).sort()) {
    hash.update("/" + entry.slice(path.length + 1) + "\0"); hash.update(await readFile(entry));
  }
  return hash.digest("hex");
}
async function bindings() {
  const inputs = {};
  for (const path of [
    "tools/terminal_bench/navigation-evidence/run.mjs", "tools/terminal_bench/navigation-evidence/feature-checks.mjs",
    "tools/terminal_bench/navigation-evidence/campaign-paths.mjs",
    "tools/terminal_bench/navigation-evidence/prepare-rerun.py", "tools/terminal_bench/navigation-evidence/wire-cap-preflight.mjs",
    "tools/terminal_bench/navigation-evidence/freeze.py", "tools/terminal_bench/navigation-evidence/controls.mjs", "packages/agent-runtime/src/harness/light-edit-recovery.test.ts", "packages/benchmark-runner/src/config.ts", "packages/benchmark-runner/src/benchmark-run.ts", "tools/terminal_bench/navigation-evidence/run.py",
    "tools/terminal_bench/corpus/identifier-token-audit.mjs",
    "tools/terminal_bench/corpus/light-study-accounting.mjs",
    "pnpm-lock.yaml", "packages/agent-runtime/dist/usage-audit.js",
  ]) inputs[path] = sha(await readFile(join(repo, path)));
  if (protocol.studyKind === "mechanism-confirmation") for (const path of [
    "tools/terminal_bench/navigation-evidence/prepare-confirmation.py",
    "tools/terminal_bench/navigation-evidence/inventory-criteria.mjs",
  ]) inputs[path] = sha(await readFile(join(repo, path)));
  inputs[join(study, "protocol.json").slice(repo.length + 1)] = sha(await readFile(join(study, "protocol.json")));
  if (protocol.commonPatchProtocol) for (const path of [protocol.commonPatchProtocol,
    join(protocol.commonPatchProtocol, "..", "common-request-cap.patch")])
    inputs[path] = sha(await readFile(join(repo, path)));
  const versions = {};
  for (const arm of ["baseline", "modified"]) {
    const directory = join(work, "frozen", panel, arm);
    versions[arm] = {
      runtime: await tree(join(directory, "agent-runtime/dist")),
      runner: await tree(join(directory, "benchmark-runner/dist")),
      source: JSON.parse(await readFile(join(directory, "version.json"), "utf8")),
    };
  }
  const projects = {};
  for (const [name, project] of Object.entries(protocol.upstreams)) {
    const root = join(repo,project.sourceRoot);
    const dependencies = join(repo,project.dependencyRoot ?? project.sourceRoot);
    projects[name] = { commit:git(["rev-parse","HEAD"],root).trim(),
      source:sha(execFileSync("git",["archive","HEAD"],{cwd:root,maxBuffer:32*1024*1024})),
      lock:sha(await readFile(join(dependencies,"package-lock.json"))) };
    if (name === "date-fns") for (const module of ["vitest","typescript","esbuild"])
      projects[name][module] = JSON.parse(await readFile(join(root,"node_modules",module,"package.json"))).version;
    else for (const module of ["lodash","qunit-extras","qunitjs","platform"])
      projects[name][module] = JSON.parse(await readFile(join(root,"node_modules",module,"package.json"))).version;
  }
  const settings = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    name.startsWith("BLAME_AGENT_") || name.startsWith("CLINE_MESSAGE_BUILDER_"))
    .sort(([a], [b]) => a.localeCompare(b)));
  return { inputs, versions, inheritedSettingsSha256:sha(JSON.stringify(settings)),
    registeredModelCatalog:getProviderCollectionSync(protocol.provider)?.models[protocol.model],
    sharedCore:await tree(join(repo,"packages/harness-core/dist")),
    sdk:JSON.parse(await readFile(join(repo,"packages/agent-runtime/node_modules/@cline/sdk/package.json"))).version,
    compiler:JSON.parse(await readFile(join(repo,"packages/agent-runtime/node_modules/typescript/package.json"))).version,
    projects, node:process.version, npmVersion:execFileSync("npm",["--version"],{encoding:"utf8"}).trim() };

}
async function verifyBindings() {
  const expected = JSON.parse(await readFile(join(study, "execution-bindings.json"), "utf8"));
  const actual = await bindings();
  for (const project of Object.values(protocol.upstreams))
    if (git(["diff","HEAD","--"],join(repo,project.sourceRoot))) throw new Error("Upstream source changed");
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Frozen execution bindings changed");
  for (const [name, value] of Object.entries({
    BLAME_MODEL_ID: protocol.model, BLAME_REASONING_EFFORT: protocol.effort,
    BLAME_PROVIDER_ID: protocol.provider, BLAME_API_URL: protocol.apiUrl,
  })) if (process.env[name] !== value) throw new Error(name + " differs from preregistration");
  if (!process.env.BLAME_API_TOKEN) throw new Error("Credential unavailable");
  return expected;
}
async function executeModel(args, directory) {
  return new Promise((done) => {
    const child = spawn(process.execPath, args, {
      cwd: repo, detached: true, stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, BLAME_HEADLESS_DEV: "true", NODE_ENV: "development",
        NODE_USE_ENV_PROXY: "1", TZ: "UTC",
        ...(protocol.budgets.requestMaxOutputTokens ? {
          BLAME_AGENT_REQUEST_MAX_OUTPUT_TOKENS: String(protocol.budgets.requestMaxOutputTokens),
        } : {}),
        BLAME_AGENT_MAX_SESSION_COST_USD: String(protocol.budgets.perTrialSdkCostLimitUsd) },
    });
    let stderr = "", watchdog = false, settled = false;
    const timer = setTimeout(() => { watchdog = true; process.kill(-child.pid, "SIGKILL"); },
      (protocol.budgets.timeoutSeconds + protocol.budgets.outerWatchdogExtraSeconds) * 1000);
    const finish = (exit) => {
      if (settled) return; settled = true; clearTimeout(timer);
      done({ ...exit, watchdog, stderr: stderr.replaceAll(process.env.BLAME_API_TOKEN, "[REDACTED]") });
    };
    child.stderr.on("data", (data) => { if (stderr.length < 4096) stderr += data.toString(); });
    child.once("error", (error) => finish({ error: error.message, code: null }));
    child.once("close", (code, signal) => finish({ code, signal }));
  });
}
function runCheck(argv, cwd, timeout = 120000, extraEnv = {}) {
  const started = performance.now();
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd, encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, TZ: "UTC", ...extraEnv },
  });
  return { argv, cwd, exitCode: result.status, signal: result.signal,
    error: result.error?.code ?? null, durationMs: performance.now() - started,
    stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
async function score(directory, workspace, task) {
  await mkdir(directory,{recursive:true});
  const feature = runCheck([process.execPath,
    join(repo, "tools/terminal_bench/navigation-evidence/feature-checks.mjs"), workspace, task.id, study], repo, 10000);
  let featureChecks = [];
  try { featureChecks = JSON.parse(feature.stdout.trim()).checks; } catch {}
  const nonUtcFeature = runCheck([process.execPath,
    join(repo, "tools/terminal_bench/navigation-evidence/feature-checks.mjs"), workspace, task.id, study], repo, 10000,
    { TZ: "America/New_York" });
  try { featureChecks.push(...JSON.parse(nonUtcFeature.stdout.trim()).checks
    .map((check) => ({ ...check, name: "non-UTC:" + check.name }))); } catch {}
  const npmTests = paths => ["npm","test","--","--maxWorkers=1","--minWorkers=1","--pool=forks",...paths];
  const isDate = task.project === "date-fns";
  const selected = runCheck(task.verifierCommands?.selected ?? (isDate ? npmTests(task.selectedTests) : [process.execPath,"test/test.js"]),workspace);
  const types = runCheck(isDate ? ["npm","run","types"] : [process.execPath,"--check","lodash.js"],workspace);
  const full = isDate ? runCheck(npmTests([]),workspace)
    : task.verifierCommands?.selected ? runCheck([process.execPath,"test/test.js"],workspace) : selected;
  const addedTests = task.newTest ? runCheck(isDate ? npmTests([task.newTest]) : [process.execPath,task.newTest],workspace) : null;
  let testCounterexample = null;
  if (task.newTest) {
    // Only copy the agent's new test into an independent original-source tree.
    // This countercheck never changes the model workspace or feeds back results.
    try {
      const added = await readFile(join(workspace,task.newTest));
      const before = join(directory,"new-test-original-source");
      await prepareWorkspace(before,task);
      await mkdir(join(before,task.newTest,".."),{recursive:true});
      await writeFile(join(before,task.newTest),added);
      testCounterexample = runCheck(isDate ? npmTests([task.newTest]) : [process.execPath,task.newTest],before);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      testCounterexample = { exitCode:null, error:"ENOENT", reason:"Requested new test absent; retain failed task." };
    }
  }
  const paths = git(["status", "--porcelain", "--untracked-files=all"], workspace)
    .trimEnd().split("\n").filter(Boolean).map((line) => line.slice(3));
  const unexpected = paths.filter((path) => !task.allowedPaths.includes(path));
  const score = { featureChecks, featureInvocation: feature, nonUtcFeatureInvocation: nonUtcFeature, selected, types, full, addedTests, testCounterexample,
    changedPaths: paths, unexpectedPaths: unexpected,
    sourceSha256: Object.fromEntries(await Promise.all(task.allowedPaths.map(async (path) =>
      [path, await readFile(join(workspace,path)).then(sha,error=>error.code==="ENOENT" ? null : Promise.reject(error))]))),
    independentFunctionalSuccess: feature.exitCode === 0 && nonUtcFeature.exitCode === 0 && featureChecks.length > 0 &&
      featureChecks.every((check) => check.passed) && selected.exitCode === 0 && types.exitCode === 0 &&
      full.exitCode === 0 && (!addedTests || addedTests.exitCode === 0) &&
      (!testCounterexample || task.newTestMustFailSeed === false || (testCounterexample.exitCode === 1 && !testCounterexample.error)) &&
      (isDate || /FAIL:\s*0\s+TOTAL:\s*6794/u.test(full.stdout)) && unexpected.length === 0 };
  await writeJson(join(directory, "score.json"), score);
  return score;
}
async function prepareWorkspace(workspace,task) {
  const upstream = join(repo,protocol.upstreams[task.project].sourceRoot);
  await mkdir(workspace,{recursive:true});
  const archive = execFileSync("git",["archive","HEAD"],{cwd:upstream,maxBuffer:32*1024*1024});
  const extracted = spawnSync("tar",["-xf","-","-C",workspace],{input:archive});
  if (extracted.status!==0) throw new Error("Source extraction failed");
  for (const [path, content] of Object.entries(task.inputFiles ?? {})) {
    await mkdir(join(workspace,path,".."),{recursive:true}); await writeFile(join(workspace,path),content);
  }
  if (task.seed) {
    const file = join(workspace,task.seed.path),text = await readFile(file,"utf8");
    if (text.split(task.seed.before).length!==2) throw new Error("Fault seed is not unique");
    await writeFile(file,text.replace(task.seed.before,task.seed.after));
  }
  git(["init","--quiet"],workspace);
  git(["add","."],workspace);
  git(["-c","user.name=Study","-c","user.email=study@example.invalid","commit","--quiet","-m","Frozen task input"],workspace,
    {GIT_AUTHOR_DATE:protocol.registeredAtUTC,GIT_COMMITTER_DATE:protocol.registeredAtUTC});
  await writeFile(join(workspace,".git/info/exclude"),".blame/\nnode_modules\n");
  await symlink(join(upstream,"node_modules"),join(workspace,"node_modules"));
}
async function run() {
  const frozen = await verifyBindings();
  await mkdir(campaign);
  const order = [];
  for (let repetition = 1; repetition <= protocol.repetitions; repetition++) {
    const tasks = repetition === 1 ? protocol.tasks : [...protocol.tasks].reverse();
    for (const task of tasks) {
      const index = protocol.tasks.indexOf(task);
      let arms = [...protocol.arms.slice(index), ...protocol.arms.slice(0, index)];
      if (repetition === 2) arms.reverse();
      for (const arm of arms) order.push({ repetition, id: task.id, arm });
    }
  }
  await writeJson(join(campaign, "provenance.json"), { frozen, order,
    startedAt: new Date().toISOString(), protocolSha256: sha(await readFile(join(study, "protocol.json"))) });
  let priorObservedCost = 0;
  const priorAccounting = [];
  for (const path of protocol.priorCampaigns ?? []) {
    const bytes = await readFile(join(repo, path));
    const prior = JSON.parse(bytes);
    if (prior.completed !== prior.planned && !protocol.retainBudgetStoppedPrior)
      throw new Error("Prior diagnostic is incomplete; do not start confirmation");
    const amount = prior.rows.reduce((sum, row) => sum + (row.usage.cost ??
      (protocol.budgets.perTrialSdkCostLimitUsd + (protocol.budgets.requestOvershootReserveUsd ?? 0))), 0);
    priorObservedCost += amount;
    priorAccounting.push({ path, sha256: sha(bytes), observedOrReservedUsd: amount });
  }
  await writeJson(join(campaign, "shared-budget-accounting.json"), { priorAccounting, priorObservedCost,
    sharedCeilingUsd: protocol.budgets.sharedStudyObservedCostStopUsd });
  let observedCost = 0;
  for (const trial of order) {
    const reservation = protocol.budgets.perTrialSdkCostLimitUsd + (protocol.budgets.requestOvershootReserveUsd ?? 0);
    if (observedCost + reservation > protocol.budgets.panelObservedCostStopUsd || priorObservedCost + observedCost + reservation > protocol.budgets.sharedStudyObservedCostStopUsd) {
      await writeJson(join(campaign, "budget-stop.json"), { observedCost, priorObservedCost, reservation, remainingFrom: trial });
      break;
    }
    await verifyBindings();
    const task = protocol.tasks.find((task) => task.id === trial.id);
    const name = [trial.repetition, trial.id, trial.arm].join("-");
    const directory = join(campaign, name), workspace = join(directory, "workspace");
    await mkdir(directory);
    let started = performance.now();
    await prepareWorkspace(workspace,task);
    await writeFile(join(directory, "instruction.txt"), task.instruction);
    await writeJson(join(directory, "required-checks.json"), task.requiredChecks);
    const preparationMs = performance.now() - started;
    const runner = join(work, "frozen", panel, trial.arm === "modified" ||
      (trial.arm === "cline" && protocol.clineRuntimeArm === "modified") ? "modified" : "baseline",
      "benchmark-runner/dist/cli.js");
    const args = [runner, "run", "--workspace", workspace, "--instruction-file", join(directory, "instruction.txt"),
      "--required-checks-file", join(directory,"required-checks.json"), "--task-id", task.id, "--events", join(directory, "events.jsonl"), "--result", join(directory, "result.json"),
      "--harness", trial.arm === "cline" ? "cline" : "blame", "--max-iterations", String(protocol.budgets.maxIterations),
      "--timeout-seconds", String(protocol.budgets.timeoutSeconds)];
    process.stdout.write("START " + name + "\n");
    started = performance.now();
    const exit = await executeModel(args, directory);
    const outerAgentMs = performance.now() - started;
    started = performance.now();
    const grade = await score(directory, workspace, task);
    const verificationMs = performance.now() - started;
    await writeFile(join(directory, "workspace.diff"), git(["diff", "--binary", "HEAD"], workspace));
    await writeJson(join(directory, "trial.json"), { ...trial, name, exit, preparationMs, outerAgentMs, verificationMs });
    const rows = await analyze();
    observedCost = rows.reduce((sum, row) => sum + (row.usage.cost ??
      (protocol.budgets.perTrialSdkCostLimitUsd + (protocol.budgets.requestOvershootReserveUsd ?? 0))), 0);
    process.stdout.write("END " + name + " functional=" + grade.independentFunctionalSuccess + "\n");
  }
}
async function analyze() {
  const provenance = JSON.parse(await readFile(join(campaign, "provenance.json"), "utf8"));
  const rows = [], ledger = [];
  for (const trial of provenance.order) {
    const name = [trial.repetition, trial.id, trial.arm].join("-");
    const directory = join(campaign, name);
    let data;
    try { data = JSON.parse(await readFile(join(directory, "trial.json"), "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; continue; }
    const score = JSON.parse(await readFile(join(directory, "score.json"), "utf8"));
    let result = {}, raw = "", events = [], parseErrors = 0;
    try { result = JSON.parse(await readFile(join(directory, "result.json"), "utf8")); } catch {}
    try { raw = await readFile(join(directory, "events.jsonl"), "utf8"); } catch {}
    for (const line of raw.split("\n").filter(Boolean)) {
      try { events.push(JSON.parse(line).event); } catch { parseErrors++; }
    }
    const requests = events.filter((event) => event.type === "notice" &&
      event.payload?.message === "Agent iteration started.").length;
    const usage = reconcileUsage(result.usage,
      events.filter((event) => event.type === "usage").map((event) => event.payload?.usage), requests);
    if (parseErrors) { usage.complete = false; usage.tokensCostReconciled = false; }
    const tools = events.filter((event) => event.type === "tool").map((event) => ({
      ...event.payload, tool: event.payload.toolCall?.name ?? event.payload.tool,
      input: event.payload.toolCall?.input ?? event.payload.input,
    })).filter((tool) => tool.phase === "finished");
    rows.push({ ...data, status: result.status ?? "missing", officialRuntimeSuccess: result.status === "succeeded",
      independentFunctionalSuccess: score.independentFunctionalSuccess,
      auditedCompletion: null, usage, durationMs: result.durationMs ?? null, metrics: result.metrics ?? null,
      completion: result.completion ?? null, parseErrors, error: result.error ?? null,
      eventsSha256: sha(raw), diffSha256: sha(await readFile(join(directory, "workspace.diff"))),
      semanticRenameCalls: tools.filter(tool => tool.tool === "edit_code" && tool.output?.status === "ok" && tool.output?.data?.semanticRename).length,
      semanticReferenceCalls: tools.filter(tool => tool.tool === "search_code" && /typescript_language_service/u.test(JSON.stringify(tool.output))).length,
      scoreSha256: sha(await readFile(join(directory, "score.json"))) });
    ledger.push({ name, tools });
  }
  await writeJson(join(campaign, "analysis.json"), { planned: provenance.order.length, completed: rows.length, provenance, rows });
  await writeJson(join(campaign, "tool-ledger.json"), ledger);
  return rows;
}
if (process.argv[2] === "prepare") {
  const task = protocol.tasks.find(t=>t.id===process.argv[5]);
  await prepareWorkspace(resolve(process.argv[4]),task);
} else if (process.argv[2] === "bind") await writeJson(join(study, "execution-bindings.json"), await bindings());
else if (process.argv[2] === "run") await run();
else if (process.argv[2] === "analyze") await analyze();
else if (process.argv[2] === "score") {
  const task = protocol.tasks.find((task) => task.id === process.argv[6]);
  await score(resolve(process.argv[4]), resolve(process.argv[5]), task);
} else throw new Error("Use prepare|bind|run|analyze|score diagnostic|confirmation [args]");
