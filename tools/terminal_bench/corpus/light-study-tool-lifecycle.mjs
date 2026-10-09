import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const campaign = resolve(process.argv[2]);
const analysis = JSON.parse(await readFile(join(campaign, "analysis.json"), "utf8"));
const trials = [];
for (const row of analysis.rows) {
  const name = row.name ?? `${row.repetition}-${row.id}-${row.arm}`;
  const raw = await readFile(join(campaign, name, "events.jsonl"), "utf8");
  const events = raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line).event);
  const calls = new Map();
  const missingIds = [];
  for (const event of events.filter((event) => event?.type === "tool")) {
    const payload = event.payload;
    const id = payload.toolCall?.id ?? payload.toolCallId;
    const observation = { phase: payload.phase, tool: payload.toolCall?.name ?? payload.tool,
      input: payload.toolCall?.input ?? payload.input };
    if (!id) { missingIds.push(observation); continue; }
    const call = calls.get(id) ?? { id, starts: [], finishes: [] };
    if (payload.phase === "started") call.starts.push(observation);
    if (payload.phase === "finished") call.finishes.push(observation);
    calls.set(id, call);
  }
  trials.push({ name, eventsSha256: createHash("sha256").update(raw).digest("hex"),
    started: [...calls.values()].reduce((sum, call) => sum + call.starts.length, 0),
    finished: [...calls.values()].reduce((sum, call) => sum + call.finishes.length, 0),
    missingIds,
    startedWithoutFinish: [...calls.values()].filter((call) => call.starts.length && !call.finishes.length),
    finishedWithoutStart: [...calls.values()].filter((call) => call.finishes.length && !call.starts.length),
    differentInputs: [...calls.values()].filter((call) => call.starts.length && call.finishes.length &&
      call.starts.some((start) => JSON.stringify(start.input) !== JSON.stringify(call.finishes.at(-1).input))),
  });
}
const result = { method: "Read every raw started/finished tool input independently of the driver's completed-tool ledger. Orphan, changed-input and missing-ID observations require explicit review; this extractor does not adjudicate external effects or leakage.", trials };
await writeFile(join(campaign, "tool-lifecycle-inspection.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ trials: trials.length,
  requiringAdditionalInputReview: trials.filter((trial) => trial.missingIds.length || trial.startedWithoutFinish.length || trial.differentInputs.length),
  finishedWithoutRecordedStart: trials.filter((trial) => trial.finishedWithoutStart.length).map((trial) => trial.name) }));
