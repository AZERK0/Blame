import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import { withoutTelemetryEnvironment } from "@blame/telemetry";

const markItDownInstallTimeoutMs = 5 * 60_000;
const markItDownRunTimeoutMs = 45_000;
let markItDownPythonPromise: Promise<string> | undefined;

export type OptimizeAttachmentForAiContextInput = {
  content: string;
  name: string;
  type: string;
};

export async function optimizeAttachmentForAiContext(
  input: OptimizeAttachmentForAiContextInput,
) {
  if (!supportedAiContextAttachment(input)) {
    throw new Error("Unsupported attachment type");
  }
  const directory = await mkdtemp(join(tmpdir(), "blame-markitdown-"));
  try {
    const path = join(directory, attachmentConversionFileName(input.name));
    await writeFile(path, Buffer.from(input.content, "base64"));
    return { markdown: trimmedAiContextMarkdown(await runMarkItDown(path)) };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

export async function optimizeDevelopmentAttachments<T extends AttachmentInput>(
  input: T,
) {
  return {
    ...input,
    feedbackFileAttachments: await optimizedAttachments(
      input.feedbackFileAttachments,
    ),
    fileAttachments: await optimizedAttachments(input.fileAttachments),
  };
}

type AttachmentInput = {
  feedbackFileAttachments?: OptimizableAttachment[];
  fileAttachments?: OptimizableAttachment[];
};

type OptimizableAttachment = Omit<
  OptimizeAttachmentForAiContextInput,
  "content"
> & {
  content?: string;
};

async function optimizedAttachments<T extends OptimizableAttachment>(
  attachments?: T[],
) {
  if (!attachments?.length) return attachments;
  return Promise.all(attachments.map(optimizedAttachment));
}

async function optimizedAttachment<T extends OptimizableAttachment>(
  attachment: T,
) {
  if (
    "aiContextMarkdown" in attachment &&
    typeof attachment.aiContextMarkdown === "string" &&
    attachment.aiContextMarkdown.trim()
  ) {
    return attachment;
  }
  if (!attachment.content) return attachment;
  if (!supportedAiContextAttachment(attachment)) return attachment;
  try {
    const result = await optimizeAttachmentForAiContext({
      content: attachment.content,
      name: attachment.name,
      type: attachment.type,
    });
    if (!result.markdown.trim()) return attachment;
    return { ...attachment, aiContextMarkdown: result.markdown };
  } catch {
    return attachment;
  }
}

function supportedAiContextAttachment(
  input: Pick<OptimizeAttachmentForAiContextInput, "name">,
) {
  return supportedAiContextExtensions().some((extension) =>
    input.name.toLowerCase().endsWith(extension),
  );
}

function supportedAiContextExtensions() {
  return [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"];
}

function attachmentConversionFileName(name: string) {
  const normalizedName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${randomUUID()}-${normalizedName || "attachment"}`;
}

async function runMarkItDown(path: string) {
  const python = await ensureMarkItDownPython();
  const script = [
    "import sys",
    "from markitdown import MarkItDown",
    "result = MarkItDown(enable_plugins=False).convert(sys.argv[1])",
    "print(result.text_content)",
  ].join("\n");
  return execFileText(
    python,
    ["-c", script, path],
    markItDownRunTimeoutMs,
  );
}

async function ensureMarkItDownPython() {
  markItDownPythonPromise ??= resolveMarkItDownPython().catch((error) => {
    markItDownPythonPromise = undefined;
    throw error;
  });
  return markItDownPythonPromise;
}

async function resolveMarkItDownPython() {
  const python = markItDownVenvPython();
  if (!(await pathExists(python))) {
    await createMarkItDownVenv();
  }
  if (!(await markItDownAvailable(python))) {
    await installMarkItDown(python);
  }
  if (await markItDownAvailable(python)) return python;
  return fallbackMarkItDownPython();
}

function markItDownVenvPython() {
  return join(
    markItDownVenvDirectory(),
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
}

function markItDownVenvDirectory() {
  return join(app.getPath("userData"), "markitdown");
}

async function createMarkItDownVenv() {
  const directory = markItDownVenvDirectory();
  await rm(directory, { force: true, recursive: true });
  const runners = pythonVenvRunners();
  let lastError: unknown;
  for (const runner of runners) {
    try {
      await execFileText(
        runner.command,
        [...runner.args, "-m", "venv", directory],
        markItDownInstallTimeoutMs,
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Python is unavailable");
}

function pythonVenvRunners() {
  if (process.platform === "win32") {
    return [
      { command: "py", args: ["-3"] },
      { command: "python", args: [] },
      { command: "python3", args: [] },
    ];
  }
  return [
    { command: "python3", args: [] },
    { command: "python", args: [] },
  ];
}

async function installMarkItDown(python: string) {
  try {
    await installMarkItDownPackage(python);
  } catch {
    await execFileText(
      python,
      ["-m", "ensurepip", "--upgrade"],
      markItDownInstallTimeoutMs,
    );
    await installMarkItDownPackage(python);
  }
}

function installMarkItDownPackage(python: string) {
  return execFileText(
    python,
    [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "markitdown[pdf,docx,pptx,xlsx,xls]",
    ],
    markItDownInstallTimeoutMs,
  );
}

async function markItDownAvailable(python: string) {
  try {
    await execFileText(python, ["-c", "import markitdown"], 15_000);
    return true;
  } catch {
    return false;
  }
}

async function fallbackMarkItDownPython() {
  const runners = [
    { command: "python3", args: ["-c", "import markitdown"] },
    { command: "python", args: ["-c", "import markitdown"] },
  ];
  let lastError: unknown;
  for (const runner of runners) {
    try {
      await execFileText(runner.command, runner.args, 15_000);
      return runner.command;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("MarkItDown is unavailable");
}

function execFileText(command: string, args: string[], timeout: number) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      command,
      args,
      {
        env: withoutTelemetryEnvironment(process.env),
        maxBuffer: 1024 * 1024 * 2,
        timeout,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function trimmedAiContextMarkdown(markdown: string) {
  const trimmed = markdown.trim();
  const maxLength = 262_144;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 42)}\n\n[Content truncated for AI context]`;
}
