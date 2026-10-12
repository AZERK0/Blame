import { sha256 } from "./light-identity.js";
import type { CheckObservation } from "./check-observation.js";

export type NodeEventBinding = { report?: string; invocationId: string; reporterSha256: string };
type Counts = { tests: number; passed: number; failed: number; skipped: number; todo: number; cancelled: number };
const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
function counts(value: unknown): Counts | undefined {
  const fields = object(value);
  if (!fields || !["tests", "passed", "failed", "skipped", "todo", "cancelled"].every(
    key => Number.isSafeInteger(fields[key]) && Number(fields[key]) >= 0 && Number(fields[key]) <= 10_000_000)) return undefined;
  const result = fields as Counts;
  return result.tests === result.passed + result.failed + result.skipped + result.todo + result.cancelled ? result : undefined;
}

/** Only an invocation-owned reporter side channel may call this parser. */
export function nodeEventEvidence(binding: NodeEventBinding) {
  if (!binding.report || Buffer.byteLength(binding.report) > 2 * 1024 * 1024) return undefined;
  try {
    const events = binding.report.trim().split("\n").map(line => object(JSON.parse(line)));
    const header = events[0], runner = object(header?.runner);
    if (header?.format !== "blame-node-events-v1" || !runner || typeof runner.version !== "string" ||
        !/^v24\./u.test(runner.version) || typeof runner.executable !== "string" ||
        events.at(-1)?.type !== "complete") return undefined;
    const files = new Map<string, Counts>(); let final: Counts | undefined;
    for (const event of events.slice(1, -1)) {
      if (final) return undefined;
      const value = counts(event?.counts);
      if (event?.type !== "summary" || !value || value.cancelled) return undefined;
      if (event.file !== undefined) {
        if (typeof event.file !== "string" || !event.file.length || files.has(event.file)) return undefined;
        files.set(event.file, value);
      } else { if (final) return undefined; final = value; }
    }
    if (!final) return undefined;
    const totals = [...files.values()].reduce((sum, file) => ({ tests: sum.tests + file.tests,
      passed: sum.passed + file.passed, failed: sum.failed + file.failed,
      skipped: sum.skipped + file.skipped, todo: sum.todo + file.todo }),
    { tests: 0, passed: 0, failed: 0, skipped: 0, todo: 0 });
    // Final aggregates include inert/failing file workers. They never count as cases.
    if (final.tests < totals.tests || final.passed < totals.passed || final.failed < totals.failed ||
        final.skipped !== totals.skipped || final.todo !== totals.todo) return undefined;
    return { counts: { executed: totals.passed + totals.failed, passed: totals.passed,
      failed: totals.failed, skipped: totals.skipped + totals.todo } satisfies CheckObservation["counts"],
      failed: final.failed > 0,
      evidence: { invocationId: binding.invocationId, reporterSha256: binding.reporterSha256,
        reportSha256: sha256(binding.report), runner, caseFiles: [...files.keys()].slice(0,128),
        caseFilesTruncated: files.size > 128,
        boundary: "Actual runner/version and reported case files; dependency coverage and complete environment remain unknown." } };
  } catch { return undefined; }
}
