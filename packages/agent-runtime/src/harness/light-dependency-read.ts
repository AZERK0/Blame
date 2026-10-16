import { realpath } from "node:fs/promises";
import { relative } from "node:path";
import type { LightReadCodeInput, LightToolResult } from "./light-contracts.js";
import { sha256 } from "./light-identity.js";
import { queryDependencyDeclaration, referenceFootprintIsCurrent } from "./semantic-reference-client.js";
import { assertMutableWorkspacePath, type WorkspaceFiles } from "./workspace-files.js";

export async function readDependencyDeclaration(
  files: WorkspaceFiles,
  input: LightReadCodeInput,
  signal?: AbortSignal,
): Promise<LightToolResult<unknown>> {
  signal?.throwIfAborted();
  const split = input.target.lastIndexOf("#");
  if (split < 1 || input.range) throw new Error("Declaration view requires localFile#importBinding.member; use nextRead for continuation.");
  const path = files.normalizePath(input.target.slice(0, split));
  const name = input.target.slice(split + 1);
  if (!/\.[cm]?[jt]sx?$/iu.test(path) ||
    !/^[\p{L}_$][\p{L}\p{N}_$]*(?:\.[\p{L}_$][\p{L}\p{N}_$]*){0,12}$/u.test(name))
    throw new Error("Declaration view requires a JS/TS file and a local import binding, optionally followed by member names.");
  assertMutableWorkspacePath(path);
  const file = await files.read(path);
  assertMutableWorkspacePath(relative(await realpath(files.root), file.absolute));
  if (file.content.byteLength > 2 * 1024 * 1024) throw new Error("Declaration consumer exceeds the source read budget.");
  const reply = await queryDependencyDeclaration({
    root: files.root, declaration: true,
    target: { path, name, hash: sha256(file.content) },
    ...(input.offset !== undefined ? { offset: input.offset } : {}),
  }, signal);
  if (reply.status !== "ok") throw new Error(`Dependency declaration unavailable: ${reply.reason}. Inspect the local import/configuration or use run_task for runtime source investigation.`);
  if (!(await referenceFootprintIsCurrent(reply.footprint, signal)))
    throw new Error("Dependency declaration inputs changed during resolution; repeat the read.");
  const { nextOffset, ...declaration } = reply.declaration;
  return { status: "ok", data: {
    target: input.target, view: "declaration", engine: "typescript_language_service",
    project: reply.project, ...declaration,
    truncated: nextOffset !== undefined,
    ...(nextOffset !== undefined ? { nextRead: { target: input.target, view: "declaration", offset: nextOffset } } : {}),
    guidance: "Read-only installed type declarations. No edit coverage or validation admission is granted; declarations do not establish runtime behavior. For a namespace, append an exported member to the local import binding.",
  } };
}
