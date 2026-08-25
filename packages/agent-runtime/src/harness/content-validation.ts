import { constants } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execa } from "execa";
import { parseCode } from "./code-intelligence.js";
import { jsoncErrors } from "./json-editor.js";
import { languageCapability } from "./language-capabilities.js";

export type ValidationStatus =
  | "passed"
  | "failed"
  | "not_supported"
  | "not_run";

export type ContentValidation = {
  path: string;
  status: ValidationStatus;
  validator: string | null;
  diagnostics: string[];
};

export async function validateContent(input: {
  content: Buffer | null;
  path: string;
  workspaceRoot: string;
}): Promise<ContentValidation> {
  const content = input.content;
  if (!content) return validation(input.path, "not_run", null, []);
  const validationInput = { ...input, content };
  const capability = languageCapability(input.path, content);
  if (capability.validatorId === "jsonc") return validateJson(validationInput);
  if (capability.validatorId === "prisma")
    return validatePrisma(validationInput);
  if (capability.validatorId === "semantic_parser")
    return validateSemantic(validationInput);
  return validation(input.path, "not_supported", null, []);
}

function validateJson(input: { content: Buffer; path: string }) {
  const errors = jsoncErrors(input.content.toString("utf8"));
  return validation(
    input.path,
    errors.length ? "failed" : "passed",
    "jsonc-parser",
    errors
      .slice(0, 20)
      .map((error) => `JSON error ${error.error} at ${error.offset}`),
  );
}

function validateSemantic(input: { content: Buffer; path: string }) {
  const parsed = parseCode(input.path, input.content);
  if (!parsed.supported)
    return validation(input.path, "not_supported", null, []);
  const status = parsed.errorCount ? "failed" : "passed";
  const diagnostics = parsed.errorCount
    ? [`Parser reported ${parsed.errorCount} syntax error(s).`]
    : [];
  return validation(input.path, status, "ast-grep", diagnostics);
}

async function validatePrisma(input: {
  content: Buffer;
  path: string;
  workspaceRoot: string;
}) {
  const executable = await localPrismaExecutable(
    input.workspaceRoot,
    input.path,
  );
  if (!executable)
    return validation(input.path, "not_supported", "prisma", [
      "The project-local Prisma validator is unavailable.",
    ]);
  return runPrismaValidation(input, executable);
}

async function runPrismaValidation(
  input: { content: Buffer; path: string; workspaceRoot: string },
  executable: string,
) {
  const directory = await mkdtemp(join(tmpdir(), "blame-prisma-validate-"));
  const schema = join(directory, "schema.prisma");
  try {
    await writeFile(schema, input.content, { mode: 0o600 });
    const result = await execa(executable, ["validate", "--schema", schema], {
      cwd: input.workspaceRoot,
      reject: false,
      timeout: 30_000,
    });
    const diagnostics = compactDiagnostics(
      `${result.stderr}\n${result.stdout}`,
    );
    return validation(
      input.path,
      result.exitCode === 0 ? "passed" : "failed",
      "prisma",
      diagnostics,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function localPrismaExecutable(workspaceRoot: string, path: string) {
  let directory = dirname(join(workspaceRoot, path));
  while (directory.startsWith(workspaceRoot)) {
    const candidate = join(directory, "node_modules", ".bin", prismaBinary());
    if (await executableExists(candidate)) return candidate;
    if (directory === workspaceRoot) break;
    directory = dirname(directory);
  }
  return undefined;
}

async function executableExists(path: string) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function prismaBinary() {
  return process.platform === "win32" ? "prisma.cmd" : "prisma";
}

function compactDiagnostics(value: string) {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-20)
    .map((line) => line.slice(0, 1_000));
}

function validation(
  path: string,
  status: ValidationStatus,
  validator: string | null,
  diagnostics: string[],
): ContentValidation {
  return { path, status, validator, diagnostics };
}
