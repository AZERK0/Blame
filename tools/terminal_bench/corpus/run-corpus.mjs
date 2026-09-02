import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  corpusRoot,
  parseArguments,
  prepareWorkspace,
  readManifest,
  repositoryRoot,
  runProcess,
  workspaceDiff,
} from "./corpus-utils.mjs";
import { scoreRun } from "./score-run.mjs";
import { writeCampaignReport } from "./report-corpus.mjs";

const options = parseArguments(process.argv.slice(2));
const harness = harnessOption(options.get("harness"));
const label = requiredOption(options, "label");
const output = resolve(
  options.get("output") ?? join(repositoryRoot, ".blame/benchmarks/corpus"),
);
const campaign = join(output, label);
const manifest = await readManifest();
const scenarios = selectedScenarios(
  manifest.scenarios,
  options.get("scenarios"),
);

await mkdir(output, { recursive: true });
await mkdir(campaign, { recursive: false });
for (const [index, scenario] of scenarios.entries())
  await executeScenario(campaign, scenario, index);
const report = await writeCampaignReport(campaign);
process.stdout.write(`${JSON.stringify({ campaign, ...report })}\n`);

async function executeScenario(campaignDirectory, scenario, index) {
  const runDirectory = join(
    campaignDirectory,
    `${String(index + 1).padStart(2, "0")}-${scenario.id}-${harness}`,
  );
  const workspace = join(runDirectory, "workspace");
  await mkdir(runDirectory, { recursive: true });
  const baseRevision = await prepareWorkspace(workspace, scenario.id);
  await writeFile(
    join(runDirectory, "base-revision.txt"),
    `${baseRevision}\n`,
    "utf8",
  );
  process.stdout.write(`START ${scenario.id} ${harness}\n`);
  const run = await executeRunner(runDirectory, workspace, scenario);
  await writeFile(
    join(runDirectory, "runner-exit.json"),
    `${JSON.stringify(run, null, 2)}\n`,
    "utf8",
  );
  const score = await scoreRun(runDirectory, workspace, scenario);
  await writeFile(
    join(runDirectory, "workspace.diff"),
    workspaceDiff(workspace),
    "utf8",
  );
  process.stdout.write(
    `END ${scenario.id} score=${score.qualityScore} status=${score.status} input=${score.tokens.input}\n`,
  );
}

function executeRunner(runDirectory, workspace, scenario) {
  const runner = join(repositoryRoot, "packages/benchmark-runner/dist/cli.js");
  const instruction = join(corpusRoot, scenario.instruction);
  const args = [
    runner,
    "run",
    "--workspace",
    workspace,
    "--instruction-file",
    instruction,
    "--task-id",
    scenario.id,
    "--events",
    join(runDirectory, "events.jsonl"),
    "--result",
    join(runDirectory, "result.json"),
    "--harness",
    harness,
    "--max-iterations",
    String(scenario.maxIterations),
    "--timeout-seconds",
    String(scenario.timeoutSeconds),
  ];
  return runProcess(process.execPath, args, repositoryRoot, {
    ...process.env,
    BLAME_HEADLESS_DEV: "true",
    NODE_ENV: "development",
  });
}

function selectedScenarios(scenarios, selection) {
  if (!selection || selection === "all") return scenarios;
  const ids = new Set(
    selection
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const selected = scenarios.filter((scenario) => ids.has(scenario.id));
  if (selected.length !== ids.size)
    throw new Error("One or more selected scenarios do not exist.");
  return selected;
}

function requiredOption(values, name) {
  const value = values.get(name)?.trim();
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

function harnessOption(value) {
  if (!value || value === "blame") return "blame";
  if (value === "cline") return "cline";
  throw new Error(`Invalid harness ${value}.`);
}
