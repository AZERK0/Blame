// F34 driver derived from F30: same transport/accounting, new archives/tasks/build checks.
// Original drivers stay unchanged; F34 uses two snapshots and a frozen balanced order.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { spawn, execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, symlink, readdir, realpath } from "node:fs/promises";
import { resolve, join } from "node:path";
import { performance } from "node:perf_hooks";
import { dirname } from "node:path";
import os from "node:os";
import {gunzipSync} from "node:zlib";
import { reconcileUsage } from "../corpus/light-study-accounting.mjs";
import { repo, work, studyFor } from "./paths.mjs";
import { getProviderCollectionSync } from "../../../packages/agent-runtime/node_modules/@cline/llms/dist/index.js";
import { reserveTrialCosts } from "../navigation-evidence/budget-accounting.mjs";
import { projectVerifiers } from "../navigation-evidence/project-verifiers.mjs";

const panel = process.argv[3];
if (panel !== "f34") throw new Error("Specify registered F34 panel");
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
    "tools/terminal_bench/navigation-evidence/budget-accounting.mjs",
    "tools/terminal_bench/navigation-evidence/campaign-paths.mjs",
    "tools/terminal_bench/navigation-evidence/project-verifiers.mjs",
    "tools/terminal_bench/navigation-evidence/source-integrity.mjs",
    "tools/terminal_bench/navigation-evidence/prepare-rerun.py", "tools/terminal_bench/navigation-evidence/wire-cap-preflight.mjs",
    "tools/terminal_bench/navigation-evidence/freeze.py", "tools/terminal_bench/navigation-evidence/controls.mjs", "packages/agent-runtime/src/harness/light-edit-recovery.test.ts", "packages/benchmark-runner/src/config.ts", "packages/benchmark-runner/src/benchmark-run.ts", "tools/terminal_bench/navigation-evidence/run.py",
    "tools/terminal_bench/corpus/identifier-token-audit.mjs",
    "tools/terminal_bench/corpus/light-study-accounting.mjs",
    "pnpm-lock.yaml", "packages/agent-runtime/dist/usage-audit.js",
  ]) inputs[path] = sha(await readFile(join(repo, path)));
  if (protocol.studyKind === "mechanism-confirmation") for (const path of [
    "tools/terminal_bench/navigation-evidence/prepare-confirmation.py",
    "tools/terminal_bench/navigation-evidence/inventory-criteria.mjs",
    "tools/terminal_bench/navigation-evidence/mechanism-controls.mjs",
    "tools/terminal_bench/navigation-evidence/wire-audit.mjs",
  ]) inputs[path] = sha(await readFile(join(repo, path)));
  if (protocol.sharedConfirmationProtocol) inputs[protocol.sharedConfirmationProtocol] =
    sha(await readFile(join(repo, protocol.sharedConfirmationProtocol)));
  if (protocol.studyKind === "declaration-navigation") for (const path of [
    "tools/terminal_bench/navigation-evidence/multifile-criteria.mjs",
    "tools/terminal_bench/navigation-evidence/prepare-declarations.mjs",
    "tools/terminal_bench/navigation-evidence/multifile-controls.mjs",
  ]) inputs[path] = sha(await readFile(join(repo, path)));
  if (protocol.studyKind === "compiler-rename-ablation") for (const path of [
    "tools/terminal_bench/navigation-evidence/prepare-rename-ablation.mjs",
    "tools/terminal_bench/navigation-evidence/rename-ablation-controls.mjs",
    "tools/terminal_bench/navigation-evidence/multifile-criteria.mjs",
  ]) inputs[path] = sha(await readFile(join(repo, path)));
  if (protocol.studyKind === "fresh-project-confirmation") for (const path of [
    "tools/terminal_bench/navigation-evidence/prepare-fresh.mjs",
    "tools/terminal_bench/navigation-evidence/fresh-criteria.mjs",
    "tools/terminal_bench/navigation-evidence/fresh-controls.mjs",
    "tools/terminal_bench/navigation-evidence/fresh-runtime-controls.mjs",
    "tools/terminal_bench/navigation-evidence/multifile-criteria.mjs",
    "tools/terminal_bench/navigation-evidence/wire-audit.mjs",
  ]) inputs[path] = sha(await readFile(join(repo, path)));
  if (protocol.studyKind === "fresh-project-confirmation") inputs[join(study,"freeze-driver.mjs").slice(repo.length+1)] = sha(await readFile(join(study,"freeze-driver.mjs")));
  if (protocol.studyKind === "corrected-native-confirmation") for(const path of [
    "tools/terminal_bench/navigation-evidence/native-search-repair.mjs",
    "tools/terminal_bench/navigation-evidence/native-repair-controls.mjs",
    "tools/terminal_bench/navigation-evidence/native-task-controls.mjs",
    "tools/terminal_bench/navigation-evidence/native-runtime-controls.mjs",
    "tools/terminal_bench/navigation-evidence/register-native2.py",
    "tools/terminal_bench/navigation-evidence/rxjs-criteria.mjs",
    "tools/terminal_bench/navigation-evidence/prepare-fresh.mjs",
    "tools/terminal_bench/navigation-evidence/fresh-criteria.mjs",
    "tools/terminal_bench/navigation-evidence/multifile-criteria.mjs",
    "tools/terminal_bench/navigation-evidence/wire-audit.mjs",
    join(study,"freeze-driver.mjs").slice(repo.length+1),
    join(study,"native-search-bindings.json").slice(repo.length+1),
  ]) inputs[path]=sha(await readFile(join(repo,path)));
  for(const name of protocol.driverInputs) {
    const path="tools/terminal_bench/invocation-model-study/"+name;
    if(!name.startsWith(".") && /\.(?:mjs|cjs|py)$/u.test(name)) inputs[path]=sha(await readFile(join(repo,path)));
  }
  for (const name of ["light-agent-guidance-fixture", "light-agent-navigation-guidance.test", "light-agent-editing-guidance.test", "light-agent-validation-guidance.test"]) {
    const path="packages/agent-runtime/src/harness/"+name+".ts";inputs[path]=sha(await readFile(join(repo,path)));
  }
  inputs[join(study,"native-search-bindings.json").slice(repo.length+1)]=sha(await readFile(join(study,"native-search-bindings.json")));
  for(const name of ["variant-sources.json","inherited-checks.json","isolation-controls.json"])inputs[join(study,name).slice(repo.length+1)]=sha(await readFile(join(study,name)));
  for(const {path,sha256} of JSON.parse(await readFile(join(study,"inherited-checks.json"))).files){
    const actual=sha(await readFile(join(repo,path)));
    if(actual!==sha256)throw Error("Inherited task/local control evidence changed: "+path);
    inputs[path]=actual;
  }
  inputs[join(study,"prompt-date-binding.json").slice(repo.length+1)]=sha(await readFile(join(study,"prompt-date-binding.json")));
  for(const path of protocol.environmentArtifacts??[])inputs[path]=sha(await readFile(join(repo,path)));
  inputs[join(study, "protocol.json").slice(repo.length + 1)] = sha(await readFile(join(study, "protocol.json")));
  if (protocol.commonPatchProtocol) for (const path of [protocol.commonPatchProtocol,
    join(protocol.commonPatchProtocol, "..", "common-request-cap.patch")])
    inputs[path] = sha(await readFile(join(repo, path)));
  const versions = {};
  for (const arm of protocol.lightArms) {
    const directory = join(work, "frozen", panel, arm);
    versions[arm] = {
      runtime: await tree(join(directory, "agent-runtime/dist")),
      runner: await tree(join(directory, "benchmark-runner/dist")),
      source: JSON.parse(await readFile(join(directory, "version.json"), "utf8")),
    };
    if(!["baseline","bundle"].includes(arm) && sha(await readFile(join(study,arm+".patch")))!==versions[arm].source.patchSha256)throw Error("Single-factor source patch changed");
    const override = versions[arm].source.sourceOverride;
    if (override && sha(await readFile(join(repo, override.patchFile))) !== override.patchSha256)
      throw Error("Archived ablation patch changed");
  }
  const projects = {};
  for (const [name, project] of Object.entries(protocol.upstreams)) {
    const root = join(repo,project.sourceRoot);
    const dependencies = join(repo,project.dependencyRoot ?? project.sourceRoot);
    projects[name] = { commit:git(["rev-parse","HEAD"],root).trim(),
      source:sha(await readFile(join(repo,project.sourceArchive))),
      lock:sha(await readFile(join(dependencies,"package-lock.json"))) };
    if (project.modules) for (const module of project.modules)
      projects[name][module] = JSON.parse(await readFile(join(dependencies,"node_modules",module,"package.json"))).version;
    else if (name === "date-fns") for (const module of ["vitest","typescript","esbuild"])
      projects[name][module] = JSON.parse(await readFile(join(root,"node_modules",module,"package.json"))).version;
    else if (name === "lodash") for (const module of ["lodash","qunit-extras","qunitjs","platform"])
      projects[name][module] = JSON.parse(await readFile(join(root,"node_modules",module,"package.json"))).version;
    else throw Error("Unknown project dependency inventory: " + name);
  }
  const settings = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    name.startsWith("BLAME_AGENT_") || name.startsWith("CLINE_MESSAGE_BUILDER_"))
    .sort(([a], [b]) => a.localeCompare(b)));
  const sdkPackage = await realpath(join(repo,"packages/agent-runtime/node_modules/@cline/sdk/package.json"));
  const sdkCoreRoot = await realpath(join(dirname(sdkPackage),"..","core"));
  return { inputs, versions, inheritedSettingsSha256:sha(JSON.stringify(settings)),
    host:{platform:os.platform(),release:os.release(),arch:os.arch(),memoryBytes:os.totalmem(),
      cpuModels:os.cpus().map(cpu=>cpu.model),executable:process.execPath},
    sdkArtifacts:{sdkDist:await tree(join(repo,"packages/agent-runtime/node_modules/@cline/sdk/dist")),
      coreDist:await tree(join(sdkCoreRoot,"dist")),
      llmsDist:await tree(join(repo,"packages/agent-runtime/node_modules/@cline/llms/dist"))},
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
async function executeModel(args, directory, arm) {
  const repair=arm==="cline"&&protocol.nativeSearchRepair===true;
  const imports=[...(protocol.captureWireContracts?["--import",join(repo,"tools/terminal_bench/navigation-evidence/wire-audit.mjs")]:[]),
    "--import",join(repo,"tools/terminal_bench/invocation-model-study/prompt-date.mjs"),
    ...(repair?["--import",join(repo,"tools/terminal_bench/navigation-evidence/native-search-repair.mjs")]:[])];
  return new Promise((done) => {
    const child = spawn(process.execPath, [...imports,...args], {
      cwd: repo, detached: true, stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, BLAME_HEADLESS_DEV: "true", NODE_ENV: "development",
        NODE_USE_ENV_PROXY: "1", TZ: "UTC",
        BLAME_STUDY_DATE_BINDING:join(study,"prompt-date-binding.json"), BLAME_STUDY_DATE_AUDIT:join(directory,"prompt-date-loads.jsonl"),
        ...(repair?{BLAME_STUDY_NATIVE_SEARCH_BINDINGS:join(study,"native-search-bindings.json"),
          BLAME_STUDY_NATIVE_SEARCH_AUDIT:join(directory,"native-search-loads.jsonl")}:{}),
        ...(protocol.captureWireContracts ? { BLAME_STUDY_WIRE_AUDIT:join(directory,"wire-contracts.jsonl"),
          BLAME_STUDY_WORKSPACE:join(directory,"workspace") } : {}),
        ...(protocol.budgets.maximumSerializedRequestBytes ? {
          BLAME_STUDY_REQUEST_MAX_BYTES: String(protocol.budgets.maximumSerializedRequestBytes),
        } : {}),
        ...(protocol.budgets.requestMaxOutputTokens ? {
          BLAME_AGENT_REQUEST_MAX_OUTPUT_TOKENS: String(protocol.budgets.requestMaxOutputTokens),
        } : {}),
        BLAME_AGENT_MAX_SESSION_COST_USD: String(protocol.budgets.perTrialSdkCostLimitUsd) },
    });
    writeFileSync(join(directory,"model-child.json"),JSON.stringify({pid:child.pid,spawnedAtUTC:new Date().toISOString()})+"\n",{flag:"wx"});
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
  const build = runCheck(task.verifierCommands.build,workspace);
  const feature = runCheck([process.execPath,
    join(repo, "tools/terminal_bench/invocation-model-study/features.mjs"), workspace, task.id, study], repo, 10000);
  let featureChecks = [];
  try { featureChecks = JSON.parse(feature.stdout.trim()).checks; } catch {}
  const nonUtcFeature = runCheck([process.execPath,
    join(repo, "tools/terminal_bench/invocation-model-study/features.mjs"), workspace, task.id, study], repo, 10000,
    { TZ: "America/New_York" });
  try { featureChecks.push(...JSON.parse(nonUtcFeature.stdout.trim()).checks
    .map((check) => ({ ...check, name: "non-UTC:" + check.name }))); } catch {}
  const npmTests = paths => ["npm","test","--","--maxWorkers=1","--minWorkers=1","--pool=forks",...paths];
  const isDate = task.project === "date-fns";
  const commands = projectVerifiers(task);
  const selected = runCheck(commands.selected,workspace);
  const types = runCheck(commands.types,workspace);
  const full = !isDate && task.project === "lodash" && !task.verifierCommands?.selected ? selected : runCheck(commands.full,workspace);
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
  const e2e = commands.e2e ? runCheck(commands.e2e,workspace) : null;
  const score = { build, e2e, featureChecks, featureInvocation: feature, nonUtcFeatureInvocation: nonUtcFeature, selected, types, full, addedTests, testCounterexample,
    changedPaths: paths, unexpectedPaths: unexpected,
    sourceSha256: Object.fromEntries(await Promise.all(task.allowedPaths.map(async (path) =>
      [path, await readFile(join(workspace,path)).then(sha,error=>error.code==="ENOENT" ? null : Promise.reject(error))]))),
    independentFunctionalSuccess: build.exitCode === 0 && feature.exitCode === 0 && nonUtcFeature.exitCode === 0 && featureChecks.length > 0 &&
      featureChecks.every((check) => check.passed) && selected.exitCode === 0 && types.exitCode === 0 &&
      full.exitCode === 0 && (!e2e || e2e.exitCode === 0) && (!addedTests || addedTests.exitCode === 0) &&
      (!testCounterexample || task.newTestMustFailSeed === false || (testCounterexample.exitCode === 1 && !testCounterexample.error)) &&
      (task.project !== "lodash" || /FAIL:\s*0\s+TOTAL:\s*6794/u.test(full.stdout)) && unexpected.length === 0 };
  await writeJson(join(directory, "score.json"), score);
  return score;
}
async function prepareWorkspace(workspace,task) {
  const upstream = join(repo,protocol.upstreams[task.project].sourceRoot);
  await mkdir(workspace,{recursive:true});
  const archive = gunzipSync(await readFile(join(repo,protocol.upstreams[task.project].sourceArchive)));
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
    {GIT_AUTHOR_DATE:protocol.taskInputCommitAtUTC ?? protocol.registeredAtUTC,
      GIT_COMMITTER_DATE:protocol.taskInputCommitAtUTC ?? protocol.registeredAtUTC});
  await writeFile(join(workspace,".git/info/exclude"),".blame/\nnode_modules\n");
  await symlink(join(upstream,"node_modules"),join(workspace,"node_modules"));
}
async function campaignBudget(rows, root) {
  const wireByTrial = {};
  for (const row of rows) {
    try { wireByTrial[row.name] = (await readFile(join(root, row.name, "wire-contracts.jsonl"), "utf8"))
      .trim().split("\n").filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return reserveTrialCosts(rows, wireByTrial, protocol.budgets);
}
async function run() {
  if(!protocol.readyForModel)throw Error("F34 remains preparation-only; final registration required");
  const frozen = await verifyBindings();
  const resuming=process.argv[2]==="resume";
  if(!resuming){
    const head=git(["rev-parse","HEAD"],repo).trim(),relative=join(study,"protocol.json").slice(repo.length+1);
    if(sha(execFileSync("git",["show",head+":"+relative],{cwd:repo}))!==sha(await readFile(join(study,"protocol.json"))))throw Error("Commit final registration before model dispatch");
    await writeFile(join(study,"launch-registration.json"),JSON.stringify({gitHead:head,protocolSha256:sha(await readFile(join(study,"protocol.json"))),recordedAtUTC:new Date().toISOString(),paidRequestsAtRegistration:0},null,2)+"\n",{flag:"wx"});
  }
  if(!resuming)await mkdir(campaign);
  const order = protocol.order;
  if (protocol.registeredOrder) {
    if (protocol.registeredOrder.length !== 1 || protocol.continuationOf?.completedBeforeRegistration !== 11)
      throw Error("Only the registered administrative single-slot continuation is allowed");
    const previous = JSON.parse(await readFile(join(repo, protocol.continuationOf.budgetStop), "utf8"));
    const slot = protocol.registeredOrder[0];
    if (JSON.stringify(slot) !== JSON.stringify(previous.remainingFrom) ||
        !protocol.tasks.some(t => t.id === slot.id) || !protocol.arms.includes(slot.arm))
      throw Error("Continuation differs from the preassigned budget-stop tail");
    order.splice(0, order.length, slot);
  }
  const registrationHash=sha(await readFile(join(study,"protocol.json")));
  if(resuming){
    const previous=JSON.parse(await readFile(join(campaign,"provenance.json")));
    if(previous.protocolSha256!==registrationHash || JSON.stringify(previous.order)!==JSON.stringify(order) || JSON.stringify(previous.frozen)!==JSON.stringify(frozen))throw Error("Administrative resume bindings changed");
  }else await writeJson(join(campaign, "provenance.json"), { frozen, order,
    startedAt: new Date().toISOString(), protocolSha256: registrationHash });
  const priorLedger=JSON.parse(await readFile(join(repo,protocol.priorBudget),"utf8"));
  const priorObservedCost=priorLedger.accountedUsd;
  const priorAccounting=[{path:protocol.priorBudget,sha256:sha(await readFile(join(repo,protocol.priorBudget))),observedOrReservedUsd:priorLedger.accountedUsd,accounting:priorLedger}];
  await writeJson(join(campaign, "shared-budget-accounting.json"), { priorAccounting, priorObservedCost,
    sharedCeilingUsd: protocol.budgets.sharedStudyObservedCostStopUsd });
  const completedRows=resuming?await analyze():[];
  const completedNames=new Set(completedRows.map(row=>row.name));
  const firstPending=order.findIndex(trial=>!completedNames.has([trial.repetition,trial.id,trial.arm].join("-")));
  if(firstPending>=0 && order.slice(firstPending).some(trial=>completedNames.has([trial.repetition,trial.id,trial.arm].join("-"))))throw Error("Completed prefix is not contiguous");
  let observedCost = (await campaignBudget(completedRows,campaign)).accountedUsd;
  for (const trial of order) {
    if(completedNames.has([trial.repetition,trial.id,trial.arm].join("-")))continue;
    const paused=await readFile(join(work,"pause-before-next-trial")).then(()=>true,error=>{if(error.code==="ENOENT")return false;throw error;});
    if(paused){await writeJson(join(campaign,"administrative-pause.json"),{next:trial,observedCost,priorObservedCost,modelRetried:false});break;}

    const reservation = protocol.budgets.perTrialSdkCostLimitUsd + (protocol.budgets.requestOvershootReserveUsd ?? 0);
    if (observedCost + reservation > protocol.budgets.panelObservedCostStopUsd || priorObservedCost + observedCost + reservation > protocol.budgets.sharedStudyObservedCostStopUsd) {
      await writeJson(join(campaign, "budget-stop.json"), { observedCost, priorObservedCost, reservation, remainingFrom: trial });
      break;
    }
    const bindingsStarted = performance.now();
    await verifyBindings();
    const bindingsVerificationMs = performance.now() - bindingsStarted;
    const task = protocol.tasks.find((task) => task.id === trial.id);
    const name = [trial.repetition, trial.id, trial.arm].join("-");
    const directory = join(campaign, name), workspace = join(directory, "workspace");
    await mkdir(directory);
    let started = performance.now();
    await prepareWorkspace(workspace,task);
    await writeFile(join(directory, "instruction.txt"), task.instruction);
    await writeJson(join(directory, "required-checks.json"), task.requiredChecks);
    const preparationMs = performance.now() - started;
    const runner = join(work,"frozen",panel,trial.arm==="cline"?"baseline":trial.arm,"benchmark-runner/dist/cli.js");
    const args = [runner, "run", "--workspace", workspace, "--instruction-file", join(directory, "instruction.txt"),
      "--required-checks-file", join(directory,"required-checks.json"), "--task-id", task.id, "--events", join(directory, "events.jsonl"), "--result", join(directory, "result.json"),
      "--harness", trial.arm === "cline" ? "cline" : "blame", "--max-iterations", String(protocol.budgets.maxIterations),
      "--timeout-seconds", String(protocol.budgets.timeoutSeconds)];
    process.stdout.write("START " + name + "\n");
    started = performance.now();
    await writeJson(join(directory,"model-start.json"),{trial,startedAtUTC:new Date().toISOString(),gitHead:git(["rev-parse","HEAD"],workspace).trim()});
    const exit = await executeModel(args, directory, trial.arm);
    await writeJson(join(directory,"model-exit.json"),{exit,outerAgentMs:performance.now()-started,finishedAtUTC:new Date().toISOString()});
    const outerAgentMs = performance.now() - started;
    started = performance.now();
    const grade = await score(directory, workspace, task);
    const verificationMs = performance.now() - started;
    await writeFile(join(directory, "workspace.diff"), git(["diff", "--binary", "HEAD"], workspace));
    await writeJson(join(directory, "trial.json"), { ...trial, name, exit, preparationMs, bindingsVerificationMs, outerAgentMs, verificationMs });
    const rows = await analyze();
    const accounting = await campaignBudget(rows,campaign);
    observedCost = accounting.accountedUsd;
    await writeJson(join(campaign,"trial-budget-accounting.json"),accounting);
    process.stdout.write("END " + name + " functional=" + grade.independentFunctionalSuccess + "\n");
  }
  const finalRows=await analyze();
  await writeJson(join(campaign,"driver-exit.json"),{finishedAtUTC:new Date().toISOString(),accountedNewUsd:observedCost,planned:order.length,completed:finalRows.length,complete:finalRows.length===order.length});
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
else if (process.argv[2] === "budget") {
  const priorLedger=JSON.parse(await readFile(join(repo,protocol.priorBudget),"utf8"));
  const priorAccounting=[{path:protocol.priorBudget,accounting:priorLedger}];
  const priorObservedOrReservedUsd = priorAccounting.reduce((sum, entry) => sum + entry.accounting.accountedUsd, 0);
  const nextAdmissionReserveUsd = protocol.budgets.perTrialSdkCostLimitUsd + (protocol.budgets.requestOvershootReserveUsd ?? 0);
  const admitted = priorObservedOrReservedUsd + nextAdmissionReserveUsd <= protocol.budgets.sharedStudyObservedCostStopUsd &&
    nextAdmissionReserveUsd <= protocol.budgets.panelObservedCostStopUsd;
  const result = { paidRequests: 0, priorAccounting, priorObservedOrReservedUsd, nextAdmissionReserveUsd,
    ceilingUsd: protocol.budgets.sharedStudyObservedCostStopUsd, admitted };
  await writeJson(join(study, "budget-preflight.json"), result);
  console.log(JSON.stringify({ ...result, priorAccounting: undefined }));
}
else if (["run","resume"].includes(process.argv[2])) await run();
else if (process.argv[2] === "analyze") await analyze();
else if (process.argv[2] === "score") {
  const task = protocol.tasks.find((task) => task.id === process.argv[6]);
  await score(resolve(process.argv[4]), resolve(process.argv[5]), task);
} else throw new Error("Use prepare|bind|budget|run|analyze|score registered-panel [args]");
