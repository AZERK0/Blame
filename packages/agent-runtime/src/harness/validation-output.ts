import { randomUUID } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { boundedDiagnostic } from "./light-diagnostic.js";

export type ValidationOutput = { output: string; outputLog?: string };

export async function validationOutput(
  workspaceRoot: string,
  output: string,
): Promise<ValidationOutput> {
  if (output.length <= 1_200) return { output };
  try {
    const directory = await validationLogDirectory(workspaceRoot);
    const name = `validation-${randomUUID()}.log`;
    await writeFile(join(directory, name), output, { flag: "wx", mode: 0o600 });
    return {
      output: boundedDiagnostic(output, "", 900),
      outputLog: `.blame/logs/${name}`,
    };
  } catch {
    return { output: boundedDiagnostic(output, "", 4_000) };
  }
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
