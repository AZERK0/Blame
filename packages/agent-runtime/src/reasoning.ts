import type { ReasoningSelection } from "./types.js";

export function reasoningConfig(
  reasoningSelection: ReasoningSelection | undefined,
) {
  if (reasoningSelection === "none") return { thinking: false };
  if (reasoningSelection === "enabled") return { thinking: true };
  return reasoningSelection
    ? { reasoningEffort: reasoningSelection, thinking: true }
    : {};
}
