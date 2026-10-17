import { posix } from "node:path";
import type { LightReadCodeInput, LightToolResult } from "./light-contracts.js";
import { inputBlocked } from "./light-read-results.js";
import { assertMutableWorkspacePath, type WorkspaceFiles, type WorkspaceSnapshot } from "./workspace-files.js";

type MissingPathContext = {
  files: WorkspaceFiles;
  input: LightReadCodeInput;
  literalPath: boolean;
  snapshot: WorkspaceSnapshot;
  signal?: AbortSignal;
};

// Discovery only: no source contents, aliases, observation coverage or writes.
export async function withMissingPathRecovery(
  context: MissingPathContext,
  read: () => Promise<LightToolResult<unknown>>,
): Promise<LightToolResult<unknown>> {
  try {
    return await read();
  } catch (error) {
    context.signal?.throwIfAborted();
    if (!context.literalPath || !missing(error)) throw error;
    const { files, input, snapshot, signal } = context;
    const requestedPath = files.normalizePath(input.target);
    assertMutableWorkspacePath(requestedPath);
    const exists = await files.pathProfile(requestedPath).then(() => true, failure => {
      if (missing(failure)) return false;
      throw error;
    });
    if (exists) throw error; // ENOENT may instead come from a journal/related read.
    signal?.throwIfAborted();
    const deleted = new Set(snapshot.changes.filter(change => change.status === "deleted").map(change => change.path));
    const matches = snapshot.files.filter(path => path !== requestedPath && !deleted.has(path) &&
      posix.basename(path) === posix.basename(requestedPath)).sort();
    // Generic basenames (for example index.ts) can yield hundreds of unrelated
    // files. Avoid an arbitrary shortlist and keep the original failure instead.
    if (matches.length > 32) throw error;
    const candidates: Array<{ path: string; nextRead: { target: string } }> = [];
    for (const path of matches) {
      signal?.throwIfAborted();
      try {
        assertMutableWorkspacePath(path);
        await files.fileSize(path); // Reject gone, non-file and escaping/symlink paths.
      } catch {
        signal?.throwIfAborted();
        continue;
      }
      signal?.throwIfAborted();
      // A leading ./ prevents a filename such as s1 from resolving as an alias.
      candidates.push({ path, nextRead: { target: `./${path}` } });
      if (candidates.length > 5) throw error;
    }
    if (!candidates.length) throw error;
    const blocked = inputBlocked(error);
    return { ...blocked, recovery: JSON.stringify({
      kind: "missing_workspace_path", requestedPath, match: "exact_basename", scope: "indexed_workspace_files",
      candidates,
      guidance: "The requested path does not exist. These indexed files share its basename; they are candidates, not resolved targets. Choose and read the intended file explicitly. This recovery returns paths only and grants no edit coverage.",
    }) };
  }
}

function missing(error: unknown) {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
