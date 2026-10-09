import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const campaign = resolve(process.argv[2] ?? ".blame/research/pilot");
const analysis = JSON.parse(
  await readFile(join(campaign, "analysis.json"), "utf8"),
);
const ledger = JSON.parse(
  await readFile(join(campaign, "tool-ledger.json"), "utf8"),
);
const decisions = [];
for (const row of analysis.rows) {
  const name = row.name ?? `${row.repetition}-${row.id}-${row.arm}`;
  const tools = ledger.find((entry) => entry.name === name).tools;
  const commands = tools.flatMap((tool, index) =>
    commandFacts(tool).map((fact) => ({ ...fact, index })),
  );
  const mutations = tools
    .map((tool, index) => ({ index, paths: mutationPaths(tool) }))
    .filter((x) => x.paths.length);
  let obligations = true,
    evidence = [];
  if (row.id === "project-arguments") {
    const selected = commands.filter(
      (c) =>
        /--test-name-pattern['"]?[=\s]/u.test(c.command) &&
        /label separator/u.test(c.command) &&
        c.success &&
        /(?:#|ℹ) pass 1\b/u.test(c.output) &&
        /(?:#|ℹ) fail 0\b/u.test(c.output),
    );
    const ranUnrelated = commands.some((c) =>
      /not ok.*unrelated|✖ unrelated|# fail [1-9]|ℹ fail [1-9]/u.test(c.output),
    );
    obligations = selected.length > 0 && !ranUnrelated;
    evidence = selected.map((c) => ({
      toolIndex: c.index,
      command: c.command,
    }));
  } else if (row.id === "proof-freshness") {
    const label = mutations.find((m) =>
      m.paths.includes("src/project-label.ts"),
    );
    const css = mutations.find((m) => m.paths.includes("src/styles.css"));
    const builds = commands.filter(
      (c) =>
        c.success &&
        /(?:npm|pnpm|yarn) (?:run )?build\b|\btsc --noEmit\b/u.test(
          c.command,
        ) &&
        /tsc --noEmit/u.test(c.output),
    );
    const between = builds.find(
      (c) => label && css && label.index < c.index && c.index < css.index,
    );
    const final = builds.find(
      (c) =>
        css && c.index > css.index && mutations.every((m) => m.index < c.index),
    );
    obligations = Boolean(between && final);
    evidence = [between, final]
      .filter(Boolean)
      .map((c) => ({ toolIndex: c.index, command: c.command }));
  } else if (
    [
      "csv-parser",
      "window-boundaries",
      "slug-contract",
      "stable-pagination",
      "webhook-idempotency",
    ].includes(row.id)
  ) {
    const edits = mutations;
    const final = commands.find(
      (c) =>
        c.success &&
        /(?:npm|pnpm|yarn) (?:run )?build\b|\btsc --noEmit\b/u.test(
          c.command,
        ) &&
        (c.command.includes("tsc --noEmit") ||
          c.output.includes("tsc --noEmit")) &&
        edits.length &&
        mutations.every((m) => m.index < c.index),
    );
    obligations = Boolean(final);
    evidence = final
      ? [{ toolIndex: final.index, command: final.command }]
      : [];
  }
  decisions.push({
    name,
    functionalSuccess: row.functionalSuccess,
    taskObligations: obligations,
    independentSuccessCandidate:
      row.functionalSuccess && obligations && row.auditCandidates === 0,
    retrievalCandidates: row.auditCandidates,
    evidence,
    review:
      "Pending independent inspection of every tool input, source diff and candidate; this script is evidence extraction, not a leakage certificate.",
  });
}
await writeFile(
  join(campaign, "audit-candidates.json"),
  JSON.stringify(
    {
      analysisSha256: createHash("sha256")
        .update(await readFile(join(campaign, "analysis.json")))
        .digest("hex"),
      decisions,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    decisions.map((d) => ({
      name: d.name,
      candidate: d.independentSuccessCandidate,
      obligations: d.taskObligations,
      retrieval: d.retrievalCandidates,
    })),
  ),
);

function commandFacts(tool) {
  if (tool.tool === "run_task") {
    const data = tool.output?.data;
    return data?.command
      ? [
          {
            command:
              tool.input.kind === "project"
                ? `${tool.input.task === "build" ? "npm run build; " : ""}${data.command}`
                : (tool.input.command ?? data.command),
            success: tool.output.status === "ok" && data.exitCode === 0,
            output: data.output ?? "",
          },
        ]
      : [];
  }
  if (tool.tool === "run_commands")
    return (tool.input.commands ?? []).map((command, i) => ({
      command,
      success: Array.isArray(tool.output) && tool.output[i]?.success === true,
      output: tool.output[i]?.result ?? "",
    }));
  return [];
}
function mutationPaths(tool) {
  if (
    tool.tool === "edit_code" &&
    tool.output?.status === "ok" &&
    tool.output.data?.changed
  )
    return tool.output.data.changes.map((c) => c.path);
  if (
    tool.tool === "apply_patch" &&
    /Successfully applied patch/u.test(JSON.stringify(tool.output))
  )
    return [
      ...tool.input.input.matchAll(
        /\*\*\* (?:Update|Add|Delete) File: ([^\n]+)/gu,
      ),
    ].map((m) => m[1].replace(/^.*\/workspace\//u, ""));
  return [];
}
