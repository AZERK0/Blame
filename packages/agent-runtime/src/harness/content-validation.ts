import { constants } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execa } from "execa";
import ts from "typescript";
import { parseCode } from "./code-intelligence.js";
import { jsoncErrors } from "./json-editor.js";
import { languageCapability } from "./language-capabilities.js";

export type ValidationStatus = "passed" | "failed" | "unsupported";

export type ContentValidation = {
  path: string;
  status: ValidationStatus;
  validator: string | null;
  diagnostics: string[];
};

export function aggregateValidationStatus(validations: ContentValidation[]) {
  if (validations.some(({ status }) => status === "failed")) return "failed";
  if (validations.some(({ status }) => status === "unsupported"))
    return "unsupported";
  if (validations.some(({ status }) => status === "passed")) return "passed";
  return "unsupported";
}

export function aggregateValidator(validations: ContentValidation[]) {
  const validators = [
    ...new Set(
      validations.flatMap(({ validator }) => (validator ? [validator] : [])),
    ),
  ];
  return validators.length ? validators.join("+") : null;
}

export async function validateContent(input: {
  content: Buffer | null;
  path: string;
  workspaceRoot: string;
}): Promise<ContentValidation> {
  const content = input.content;
  if (!content) return validation(input.path, "unsupported", null, []);
  const validationInput = { ...input, content };
  const capability = languageCapability(input.path, content);
  if (capability.validatorId === "jsonc") return validateJson(validationInput);
  if (capability.validatorId === "prisma")
    return validatePrisma(validationInput);
  if (capability.validatorId === "typescript")
    return validateTypeScript(validationInput);
  if (capability.validatorId === "semantic_parser")
    return validateSemantic(validationInput);
  return validation(input.path, "unsupported", null, []);
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
  if (!parsed.supported) return validation(input.path, "unsupported", null, []);
  const status = parsed.errorCount ? "failed" : "passed";
  const diagnostics = parsed.errorCount
    ? [`Parser reported ${parsed.errorCount} syntax error(s).`]
    : [];
  return validation(input.path, status, "ast-grep", diagnostics);
}

function validateTypeScript(input: { content: Buffer; path: string }) {
  const source = ts.createSourceFile(
    input.path,
    input.content.toString("utf8"),
    ts.ScriptTarget.Latest,
    true,
    typescriptScriptKind(input.path),
  );
  const parsed = source as ts.SourceFile & {
    parseDiagnostics: readonly ts.DiagnosticWithLocation[];
  };
  const diagnostics = parsed.parseDiagnostics.slice(0, 20).map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      "\n",
    );
    if (diagnostic.start === undefined) return message;
    const position = source.getLineAndCharacterOfPosition(diagnostic.start);
    return `${position.line + 1}:${position.character + 1} ${message}`;
  });
  return validation(
    input.path,
    diagnostics.length ? "failed" : "passed",
    "typescript",
    diagnostics,
  );
}

function typescriptScriptKind(path: string) {
  const extension = path.toLowerCase().match(/\.[^.]+$/u)?.[0];
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if ([".js", ".cjs", ".mjs"].includes(extension ?? ""))
    return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
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
    return validation(input.path, "unsupported", "prisma", [
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
