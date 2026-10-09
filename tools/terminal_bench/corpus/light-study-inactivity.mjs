import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const campaign = resolve(process.argv[2]);
const analysis = JSON.parse(await readFile(join(campaign, "analysis.json"), "utf8"));
const ledger = JSON.parse(await readFile(join(campaign, "tool-ledger.json"), "utf8"));
const findings = [];
for (const row of analysis.rows.filter((trial) => trial.status === "timed_out")) {
  const raw = await readFile(join(campaign, row.name, "events.jsonl"), "utf8");
  const events = raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const result = JSON.parse(await readFile(join(campaign, row.name, "result.json"), "utf8"));
  const counts = {};
  for (const { event } of events) counts[event?.type] = (counts[event?.type] ?? 0) + 1;
  const lastText = events.findLastIndex(({ event }) => event?.type === "text");
  findings.push({ name: row.name, eventsSha256: createHash("sha256").update(raw).digest("hex"),
    lastRecordedAt: events.at(-1)?.recordedAt ?? null, finishedAt: result.finishedAt,
    lastIteration: Math.max(0, ...events.map(({ event }) => event?.payload?.iteration ?? 0)),
    eventCounts: Object.fromEntries(["usage", "text", "error", "done", "tool"].map((key) => [key, counts[key] ?? 0])),
    completedToolCalls: ledger.find((trial) => trial.name === row.name).tools.length,
    usageAfterFinalText: lastText >= 0 && events.slice(lastText + 1).some(({ event }) => event?.type === "usage"),
    finalRecordedEventToDeadlineMs: events.length
      ? Date.parse(result.finishedAt) - Date.parse(events.at(-1).recordedAt) : null,
    observation: "Recorded event gap before configured timeout; inspect source, validation and event sequence independently. There is no HTTP wire observation. Provider versus SDK cause is unresolved; inactivity does not prove a recognized recoverable transport exception. Cancellation can discard subsequent SDK events.",
  });
}
const result = { observedAt: new Date().toISOString(),
  helperSha256: createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex"), findings };
await writeFile(join(campaign, "inactivity-diagnostics.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
