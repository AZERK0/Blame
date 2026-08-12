import {
  parseRunConfigurations,
  validateProjectInitializationOutput,
  type ProjectInitializationScan,
} from "./project-initialization.js";
import {
  generatePreviewArtifacts,
  parsePreviewManifest,
} from "./preview-manifest.js";
import type {
  ProjectInitializationRepairClassification,
  RepairProjectInitializationInput,
  RepairProjectInitializationResult,
} from "./types.js";

const classifications = new Set<ProjectInitializationRepairClassification>([
  "repairable_initialization",
  "project_code_failure",
  "external_failure",
  "unknown",
]);
const maxCorrectionPayloadLength = 24_000;

type ProjectInitializationRepairCorrection = {
  validationError: string;
  previousResult: string;
};

export function projectInitializationRepairPrompt(
  input: RepairProjectInitializationInput,
  scan: ProjectInitializationScan,
  correction?: ProjectInitializationRepairCorrection,
) {
  const prompt = repairPrompt(input, scan);
  if (!correction) return prompt;
  return [
    prompt,
    "Your previous response was rejected by validation.",
    "Fix only the generated JSON output according to the validation error.",
    "Do not broaden the diagnosis and do not read more files.",
    "Return a complete corrected JSON object only.",
    `Validation error: ${correction.validationError}`,
    `Previous rejected response: ${correction.previousResult.slice(0, maxCorrectionPayloadLength)}`,
  ].join("\n");
}

export function parseProjectInitializationRepairResult(
  text: string,
  scan?: ProjectInitializationScan,
): Omit<RepairProjectInitializationResult, "sessionId"> {
  const parsed = JSON.parse(jsonPayload(text)) as unknown;
  if (!isRecord(parsed))
    throw new Error("Initialization repair result must be an object");
  const classification = classificationValue(parsed.classification);
  assertOnlyKeys(
    parsed,
    classification === "repairable_initialization"
      ? ["classification", "reason", "previewManifest", "runConfigurations"]
      : ["classification", "reason"],
  );
  const reason = stringValue(parsed.reason);
  if (!reason)
    throw new Error("Initialization repair result is missing reason");
  if (classification !== "repairable_initialization")
    return { classification, reason };
  if (!parsed.previewManifest) {
    throw new Error(
      "Repairable initialization result must include a canonical previewManifest",
    );
  }
  const previewManifest = parsePreviewManifest(parsed.previewManifest);
  const generated = generatePreviewArtifacts(previewManifest);
  const setupScript = generated.setupScript;
  const dockerCompose = generated.dockerCompose;
  const runConfigurations = parseRunConfigurations(parsed.runConfigurations);
  validateProjectInitializationOutput(
    setupScript,
    dockerCompose,
    runConfigurations,
    scan,
    previewManifest,
  );
  return {
    classification,
    reason,
    previewManifest,
    runConfigurations,
  };
}

function repairPrompt(
  input: RepairProjectInitializationInput,
  scan: ProjectInitializationScan,
) {
  return [
    "Diagnose these project initialization diagnostics according to your system instructions and return strict JSON only.",
    `Current previewManifest: ${JSON.stringify(input.previewManifest)}`,
    `Current runConfigurations: ${JSON.stringify(input.runConfigurations)}`,
    `Initialization diagnostics: ${JSON.stringify(input.diagnostics)}`,
    `Project root entries: ${JSON.stringify(scan.topLevelEntries)}`,
    `Project discovery: ${JSON.stringify(scan.discovery ?? null)}`,
    `Project evidence files: ${JSON.stringify(scan.files)}`,
  ].join("\n");
}

function classificationValue(value: unknown) {
  if (
    typeof value !== "string" ||
    !classifications.has(value as ProjectInitializationRepairClassification)
  ) {
    throw new Error(
      "Initialization repair result has an invalid classification",
    );
  }
  return value as ProjectInitializationRepairClassification;
}

function jsonPayload(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match?.[1]) return match[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
  const keys = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !keys.has(key));
  if (unknown) {
    throw new Error(
      `Initialization repair result contains unsupported field ${unknown}`,
    );
  }
}
