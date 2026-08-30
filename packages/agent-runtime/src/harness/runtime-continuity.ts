import type { RuntimeContinuity } from "./conversation-memory.js";
import { sha256 } from "./protocol.js";

export function renderRuntimeContinuity(value: RuntimeContinuity) {
  return [
    "<blame_deterministic_capsule>",
    section("User intent", [
      `Exact request preserved in preceding user text; sha256=${sha256(value.activeRequest)}`,
    ]),
    section("Active constraints", value.constraints),
    section("Completed work", value.completedWork),
    section("Current repository state", [value.currentRepositoryState]),
    section("Changed files and content hashes", value.changedFiles),
    section("Decisions", value.decisions),
    section("Runtime observations", value.observations),
    section("Inspected files", value.inspectedFiles),
    section("Inspected symbols", value.verifiedSymbols),
    section("Skills already loaded", value.skills),
    section("Specialists already consulted", value.specialists),
    section("Failed attempts and recovery conditions", value.failedAttempts),
    section(
      "Validation evidence at current revision",
      value.validationEvidence,
    ),
    section("Validation summary", [value.validation]),
    section("Known infrastructure failures", value.knownInfrastructureFailures),
    section("Open problems", value.openProblems),
    section("Next intended action", [value.nextAction]),
    "</blame_deterministic_capsule>",
  ]
    .filter(Boolean)
    .join("\n");
}

function section(label: string, values: string[]) {
  const selected = values.map((value) => value.trim()).filter(Boolean);
  if (!selected.length) return "";
  return `${label}:\n${selected.map((value) => `- ${value}`).join("\n")}`;
}
