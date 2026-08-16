import {
  semanticWorkspaceReadToolNames,
  semanticWorkspaceWriteToolNames,
} from "./harness/cline-tools.js";

export const readTools: string[] = [
  "fetch_web_content",
  "get_preview_devtools",
  "get_preview_container_logs",
  ...semanticWorkspaceReadToolNames,
];

export const writeTools: string[] = [...semanticWorkspaceWriteToolNames];

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

export const blockedCommandParts = [
  "rm -rf",
  "sudo",
  "curl | sh",
  "wget | sh",
  "> /dev/",
];
