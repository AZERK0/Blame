import { codeReviewGraphToolNames } from "./code-review-graph-tools.js";
import {
  semanticWorkspaceReadToolNames,
  semanticWorkspaceWriteToolNames,
} from "./harness/cline-tools.js";

export const readTools = [
  "read_files",
  "search_codebase",
  "fetch_web_content",
  "get_preview_devtools",
  "get_preview_container_logs",
  ...codeReviewGraphToolNames,
  ...semanticWorkspaceReadToolNames,
];

export const initializationFallbackReadTools = new Set([
  "read_files",
  "search_codebase",
]);

export const writeTools = [
  "run_commands",
  "editor",
  "apply_patch",
  ...semanticWorkspaceWriteToolNames,
];

export const blockedCommandParts = [
  "rm -rf",
  "sudo",
  "curl | sh",
  "wget | sh",
  "> /dev/",
];
