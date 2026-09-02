import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  parseArguments,
  readManifest,
  workspaceDiff,
} from "./corpus-utils.mjs";
import { writeCampaignReport } from "./report-corpus.mjs";
import { scoreRun } from "./score-run.mjs";

const options = parseArguments(process.argv.slice(2));
const campaign = resolve(requiredOption(options, "campaign"));
const manifest = await readManifest();
const scenarios = new Map(
  manifest.scenarios.map((scenario) => [scenario.id, scenario]),
);

for (const directory of await runDirectories(campaign)) {
  const result = await readResult(directory);
  const scenario = scenarios.get(result.taskId);
  if (!scenario) throw new Error(`Unknown scenario ${result.taskId}.`);
  const workspace = join(directory, "workspace");
  await scoreRun(directory, workspace, scenario);
  await writeFile(join(directory, "workspace.diff"), workspaceDiff(workspace));
}

process.stdout.write(
  `${JSON.stringify(await writeCampaignReport(campaign))}\n`,
);

async function runDirectories(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name));
}

async function readResult(directory) {
  const content = await readFile(join(directory, "result.json"), "utf8");
  return JSON.parse(content);
}

function requiredOption(values, name) {
  const value = values.get(name)?.trim();
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}
