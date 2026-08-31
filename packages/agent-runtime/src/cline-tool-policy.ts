import {
  lightReadToolNames,
  lightWriteToolNames,
} from "./harness/light-tools.js";
export { blockedCommandParts } from "./harness/command-policy.js";

export const readTools: string[] = [
  "finish_task",
  "consult_specialist",
  "fetch_web_content",
  "get_preview_devtools",
  "get_preview_container_logs",
  ...lightReadToolNames,
];

export const writeTools: string[] = [...lightWriteToolNames];

// These Cline built-ins bypass source revisions, immutable proposals, and the
// execution overlay. They remain available only to the dedicated project-
// initialization workflow, whose migration is independent from the coding
// harness and whose policy explicitly opts into its read-only fallbacks.
export const legacyDirectWorkspaceTools = [
  "read_files",
  "search_codebase",
  "run_commands",
  "editor",
  "apply_patch",
];

export const initializationFallbackReadTools = new Set([
  "read_files",
  "search_codebase",
]);
