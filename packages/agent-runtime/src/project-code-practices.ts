import type {
  ProjectCodePracticeKey,
  ProjectCodePracticeResult,
} from "./types.js";
import type { ProjectInitializationScan } from "./project-initialization.js";
import { jsonPayload } from "./json-payload.js";

const requiredPractices: ProjectCodePracticeKey[] = [
  "coding_style",
  "unit_tests",
  "layered_architecture",
  "commit_message_convention",
];

type CodePracticesCorrection = {
  validationError: string;
  previousResult: string;
};

export const projectCodePracticesResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["practices"],
  properties: {
    practices: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["practice", "detected", "comment"],
        properties: {
          practice: { enum: requiredPractices },
          detected: { type: "boolean" },
          comment: { type: "string" },
        },
      },
    },
  },
} as const;

export function projectCodePracticesPrompt(scan: ProjectInitializationScan) {
  return [
    "Analyze the code practices in this project scan according to your system instructions.",
    "Call submit_project_code_practices exactly once with the complete result.",
    "Do not answer with JSON text.",
    `Project: ${scan.rootName}`,
    `Root entries: ${JSON.stringify(scan.topLevelEntries)}`,
    `Recent git log: ${JSON.stringify(scan.gitLog)}`,
    `Strategic files: ${JSON.stringify(scan.files)}`,
  ].join("\n");
}

export function projectCodePracticesCorrectionPrompt(
  scan: ProjectInitializationScan,
  correction: CodePracticesCorrection,
) {
  return [
    projectCodePracticesPrompt(scan),
    "Your previous tool input was rejected by validation.",
    "Call submit_project_code_practices again with a complete corrected input.",
    `Validation error: ${correction.validationError}`,
    `Previous rejected input: ${correction.previousResult.slice(0, 24_000)}`,
  ].join("\n");
}

export function parseProjectCodePracticesResult(
  value: unknown,
): ProjectCodePracticeResult[] {
  const parsed = typeof value === "string" ? parseText(value) : value;
  if (!isRecord(parsed) || !Array.isArray(parsed.practices)) {
    throw new Error("Code practice analysis result is missing practices");
  }
  const practices = parsed.practices;
  if (practices.length !== requiredPractices.length) {
    throw new Error(
      "Code practice analysis must contain exactly four practices",
    );
  }
  return requiredPractices.map((practice) =>
    parsePractice(practices, practice),
  );
}

function parseText(value: string) {
  return JSON.parse(jsonPayload(value)) as unknown;
}

function parsePractice(values: unknown[], practice: ProjectCodePracticeKey) {
  const value = values.find(
    (item) => isRecord(item) && item.practice === practice,
  );
  if (!isRecord(value))
    throw new Error(`Code practice analysis is missing ${practice}`);
  if (typeof value.detected !== "boolean") {
    throw new Error(`${practice} detected must be boolean`);
  }
  const comment = stringValue(value.comment);
  if (!comment) throw new Error(`${practice} comment is required`);
  return { practice, detected: value.detected, comment };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
