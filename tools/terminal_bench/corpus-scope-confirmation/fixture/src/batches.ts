import { MAX_BATCH } from "../packages/settings/src/settings";

export function splitIds(ids: readonly string[]): string[][] {
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += MAX_BATCH) {
    batches.push(ids.slice(index, index + MAX_BATCH));
  }
  return batches;
}
