import { createHash } from "node:crypto";

export function previewPartition(storageKey: string) {
  const digest = createHash("sha256")
    .update(storageKey)
    .digest("hex")
    .slice(0, 32);
  return `persist:blame-preview-${digest}`;
}
