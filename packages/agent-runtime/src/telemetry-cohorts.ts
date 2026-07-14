export type TaskComplexityBucket = "small" | "medium" | "large";

export function taskComplexityBucket(
  promptLength: number,
  attachmentCount: number,
): TaskComplexityBucket {
  if (promptLength < 1_000 && attachmentCount === 0) return "small";
  if (promptLength < 4_000 && attachmentCount <= 3) return "medium";
  return "large";
}
