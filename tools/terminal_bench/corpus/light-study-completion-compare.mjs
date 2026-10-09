import { createHash } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const directory = resolve(process.argv[2]);
const raw = await readFile(join(directory, "results.json"));
const results = JSON.parse(raw);
const temporary = await mkdtemp(join(tmpdir(), "blame-completed-comparison-"));
try {
  const excludedDespiteAuditedCriteria = results.rows.filter((row) => row.auditedSuccess && row.status !== "succeeded")
    .map(({ name, status }) => ({ name, status }));
  for (const row of results.rows) row.auditedSuccess &&= row.status === "succeeded";
  await writeFile(join(temporary, "results.json"), JSON.stringify(results));
  execFileSync(process.execPath, [fileURLToPath(new URL("./light-study-compare.mjs", import.meta.url)), temporary], { stdio: "ignore" });
  const comparison = JSON.parse(await readFile(join(temporary, "paired-comparison.json"), "utf8"));
  const result = { ...comparison, originalResultsSha256: createHash("sha256").update(raw).digest("hex"),
    selection: "Exploratory additional qualification after observing criteria fulfilled but runtime completion refused. Original frozen score, audit-criteria endpoint and paired comparison remain unchanged. All comparisons/partitions retained.",
    method: "The existing task-cluster resource comparison additionally requires both audited instruction criteria AND successful runtime termination. Conditional cohorts do not replace full-panel failure/resource accounting or prove population equivalence.",
    baseMethod: comparison.method, excludedDespiteAuditedCriteria };
  await writeFile(join(directory, "completed-paired-comparison.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ excludedDespiteAuditedCriteria, comparisons: result.comparisons.length }));
} finally { await rm(temporary, { recursive: true, force: true }); }
