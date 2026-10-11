import { resolve } from "node:path";
import type { LightAliasRegistry } from "./light-aliases.js";
import { capabilityForPath } from "./light-capabilities.js";
import { sha256 } from "./light-identity.js";
import {
  querySemanticReferences,
  referenceFootprintIsCurrent,
} from "./semantic-reference-client.js";
import { semanticReferenceLimits } from "./semantic-reference-types.js";
import type { WorkspaceFiles, WorkspaceSnapshot } from "./workspace-files.js";

export async function planSemanticRename(
  aliases: LightAliasRegistry,
  files: WorkspaceFiles,
  snapshot: WorkspaceSnapshot,
  target: string,
  newName: string,
  signal?: AbortSignal,
) {
  const resolved = await aliases.resolveSymbol(
    target,
    files,
    snapshot.revision.source_revision_id,
    true,
  );
  const [start, end] = resolved.symbol.range_utf8_bytes;
  aliases.assertObserved(resolved.alias, [0, end - start]);
  if (
    !["typescript", "tsx", "javascript", "jsx"].includes(
      capabilityForPath(resolved.path)?.language ?? "",
    )
  )
    throw new Error("Semantic rename requires a configured JS/TS project.");
  const reply = await querySemanticReferences(
    {
      root: files.root,
      renameTo: newName,
      target: {
        path: resolved.path,
        name: resolved.symbol.qualified_name,
        start,
        end,
        hash: sha256(resolved.content),
      },
    },
    signal,
    semanticReferenceLimits.renameTimeoutMs,
  );
  if (reply.status !== "ok")
    throw new Error(
      `Semantic rename blocked: ${reply.reason}. Use inspected focused edits if appropriate.`,
    );
  if (!(await referenceFootprintIsCurrent(reply.footprint, signal)))
    throw new Error(
      "Semantic rename source or dependency changed. Read again and retry.",
    );
  const sources = new Map<string, Buffer>();
  for (const location of reply.locations) {
    const path = files.normalizePath(location.path);
    if (location.replacement === undefined)
      throw new Error("Invalid semantic rename plan.");
    if (!sources.has(path)) sources.set(path, (await files.read(path)).content);
    const expected = reply.footprint.reads.find(
      (entry) => entry.path === resolve(files.root, path),
    );
    if (!expected || sha256(sources.get(path)!) !== expected.hash)
      throw new Error("Semantic rename preimage changed.");
  }
  return {
    reply,
    sources,
    targetPath: resolved.path,
    oldQualifiedName: resolved.symbol.qualified_name,
    newQualifiedName: resolved.symbol.qualified_name.replace(
      /[^./]+$/u,
      newName,
    ),
  };
}
