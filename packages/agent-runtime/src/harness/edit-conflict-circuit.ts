import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { lock } from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import { decodeHandle, sha256 } from "./protocol.js";
import type { EditCodeOperation } from "./schemas.js";

type ConflictState = Record<string, { count: number; updatedAt: string }>;

export class EditConflictCircuit {
  private readonly path: string;
  private readonly lockDirectory: string;

  constructor(workspaceRoot: string, sessionId: string) {
    const root = join(workspaceRoot, ".blame", "harness", "edit-conflicts");
    const identity = sha256(sessionId);
    this.path = join(root, `${identity}.json`);
    this.lockDirectory = join(root, `${identity}.lock`);
  }

  blocked(edits: EditCodeOperation[]) {
    return this.exclusive(async () => {
      const state = await this.read();
      return operationKeys(edits).find((key) => (state[key]?.count ?? 0) >= 2);
    });
  }

  recordConflict(edits: EditCodeOperation[]) {
    return this.exclusive(async () => {
      const state = await this.read();
      for (const key of operationKeys(edits))
        state[key] = {
          count: (state[key]?.count ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        };
      await this.write(state);
    });
  }

  recordApplied(edits: EditCodeOperation[]) {
    return this.exclusive(async () => {
      const state = await this.read();
      for (const key of operationKeys(edits)) delete state[key];
      await this.write(state);
    });
  }

  private async exclusive<T>(operation: () => Promise<T>) {
    await mkdir(this.lockDirectory, { recursive: true, mode: 0o700 });
    const release = await lock(this.lockDirectory, {
      realpath: false,
      retries: { retries: 40, factor: 1.2, minTimeout: 10, maxTimeout: 500 },
      stale: 30_000,
    });
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  private async read(): Promise<ConflictState> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as ConflictState;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return {};
      throw error;
    }
  }

  private async write(state: ConflictState) {
    await mkdir(join(this.path, ".."), { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.path, JSON.stringify(state), {
      fsync: true,
      mode: 0o600,
    });
  }
}

function operationKeys(edits: EditCodeOperation[]) {
  return [...new Set(edits.flatMap(operationKey))];
}

function operationKey(edit: EditCodeOperation) {
  const path = editPath(edit);
  return path ? [`${path}\0${operationFamily(edit.operation)}`] : [];
}

function editPath(edit: EditCodeOperation) {
  if ("path" in edit) return edit.path;
  if ("from_path" in edit) return edit.from_path;
  if (!("target" in edit)) return undefined;
  const reference =
    "symbol_ref" in edit.target ? edit.target.symbol_ref : edit.target.node_ref;
  return (
    decodeHandle(reference, "sym")?.path ??
    decodeHandle(reference, "node")?.path
  );
}

function operationFamily(operation: EditCodeOperation["operation"]) {
  if (operation === "edit_json") return "json";
  if (operation === "patch" || operation === "patch_file") return "patch";
  if (operation.endsWith("_file")) return "file";
  return "semantic";
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
