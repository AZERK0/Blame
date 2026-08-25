export type HarnessFeatureFlag =
  | "BLAME_CONTEXT_EPOCHS"
  | "BLAME_SEMANTIC_READ_REBASE"
  | "BLAME_WORKING_SET_V2"
  | "BLAME_SEMANTIC_REBASE_V2"
  | "BLAME_PATCH_RECOVERY_V2"
  | "BLAME_COST_GOVERNOR_V2"
  | "BLAME_STRUCTURED_COMPLETION"
  | "BLAME_CONTINUITY_DELTA"
  | "BLAME_MEMORY_AUTHORITY_V2"
  | "BLAME_HARD_CAPSULE_BUDGET"
  | "BLAME_SEMANTIC_RECALL"
  | "BLAME_OPENROUTER_EMBEDDINGS";

export function harnessFeatureEnabled(
  name: HarnessFeatureFlag,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const value = environment[name]?.trim().toLowerCase();
  if (name === "BLAME_OPENROUTER_EMBEDDINGS" && value === undefined)
    return false;
  return value !== "0" && value !== "false" && value !== "off";
}
