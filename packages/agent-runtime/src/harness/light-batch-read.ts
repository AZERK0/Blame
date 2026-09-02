import type { LightToolResult } from "./light-contracts.js";

type ReadTarget = (target: string) => Promise<LightToolResult<unknown>>;

export async function batchReadCode(
  requestedTargets: string[],
  readTarget: ReadTarget,
): Promise<LightToolResult<unknown>> {
  const targets = [...new Set(requestedTargets)];
  const results = [];
  for (const target of targets) {
    const result = await readTarget(target);
    results.push({ result, target });
  }
  return {
    status: "ok",
    data: {
      requested: requestedTargets.length,
      results,
      returned: results.length,
      view: "batch",
    },
  };
}
