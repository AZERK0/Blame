import { randomUUID } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { boundedDiagnostic } from "./light-diagnostic.js";

export type ValidationOutput = { output: string; outputLog?: string };

export async function validationOutput(
  workspaceRoot: string,
  output: string,
  maximum = 900,
): Promise<ValidationOutput> {
  if (output.length <= 1_200) return { output };
  try {
    const directory = await validationLogDirectory(workspaceRoot);
    const name = `validation-${randomUUID()}.log`;
    await writeFile(join(directory, name), output, { flag: "wx", mode: 0o600 });
    return {
      output: boundedValidationDiagnostic(output, maximum),
      outputLog: `.blame/logs/${name}`,
    };
  } catch {
    return { output: boundedValidationDiagnostic(output, 4_000) };
  }
}

/** Preserve detected aggregate lines as raw observations, never as admission. */
export function boundedValidationDiagnostic(output: string, maximum: number) {
  const ordinary = boundedDiagnostic(output, "", maximum);
  if (output.length <= maximum || maximum < 256) return ordinary;
  const summaries: Array<{ line: number; text: string; start: number; end: number }> = [];
  let start = 0;
  for (const [index, raw] of output.split("\n").entries()) {
    // ANSI SGR is presentation; line numbers still refer to the full output.
    // eslint-disable-next-line no-control-regex
    const text = raw.replace(/\x1b\[[0-9;]*m/gu, "").trim();
    if (/^(?:(?:#|ℹ)\s+(?:tests|suites|pass|fail|cancelled|skipped|todo)\s+\d+\b|(?:Test Suites|Tests|Snapshots):\s|\d+\s+(?:passing|failing|pending)\b|(?:PASS|FAIL):\s*\d)/u.test(text))
      summaries.push({ line: index + 1, text, start, end: start + raw.length });
    start += raw.length + 1;
  }
  const half = Math.floor((maximum - 32) / 2);
  if (!summaries.some(line => line.end > half && line.start < output.length - half))
    return ordinary;

  const budget = Math.min(600, Math.floor(maximum * 0.65));
  const selected: Array<{ line: number; text: string }> = [];
  let used = 100; // Includes the header and omission notice.
  for (let index = 0; index < Math.min(summaries.length, 20); index++) {
    const position = index % 2 === 0 ? index / 2 : summaries.length - 1 - Math.floor(index / 2);
    const line = summaries[position]!;
    const text = "L" + line.line + ": " + (line.text.length > 120 ? line.text.slice(0, 117) + "…" : line.text);
    if (used + text.length + 1 > budget) break;
    used += text.length + 1;
    selected.push({ line: line.line, text });
  }
  if (!selected.length) return ordinary;
  selected.sort((a, b) => a.line - b.line);
  const header = "Summary index (" + selected.length + "/" + summaries.length + " detected lines; not verification):";
  const summary = [header, ...selected.map(line => line.text),
    ...(selected.length < summaries.length ? ["Other summary lines omitted; consult the full log."] : [])].join("\n");
  const context = boundedDiagnostic(output, "", maximum - summary.length - 1);
  return context + "\n" + summary;
}

async function validationLogDirectory(workspaceRoot: string) {
  let directory = workspaceRoot;
  for (const segment of [".blame", "logs"]) {
    directory = join(directory, segment);
    await mkdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink())
      throw new Error("Validation log directory is not a regular directory.");
  }
  return directory;
}
