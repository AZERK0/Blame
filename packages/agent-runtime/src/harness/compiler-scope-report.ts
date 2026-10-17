import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { sha256 } from "./light-identity.js";
import type { TaskCatalogItem, TaskInvocation } from "./task-catalog.js";
import type { WorkspaceCommandResult } from "./workspace-command-process.js";
import type { WorkspaceFiles, WorkspaceSnapshot } from "./workspace-files.js";

export type CompilerScopeReport = {
  status: "reported" | "unknown" | "stale";
  basis: "typescript_listFiles";
  sourceRevisionId: string;
  compilerVersion?: string;
  compilerIdentity?: string;
  manifestEnvironment?: { before: string; after: string; boundary: string };
  reportedWorkspaceFiles?: number;
  reportedPathsSha256?: string;
  changedFilesReported: string[];
  changedFilesNotReported: string[];
  changedFilesUnknown: string[];
  changedFilesTotal: number;
  omittedChangedFiles: number;
  reason?: string;
  guidance: string;
};

export type CompilerScopeCapture = {
  invocation: TaskInvocation;
  observe(result: WorkspaceCommandResult, snapshot: WorkspaceSnapshot, changedPaths: string[], sourceRevisionId: string): Promise<{ output: string; report: CompilerScopeReport }>;
};

/** Diagnostic only. Never grants file coverage, admission or a completion gate. */
export async function compilerScopeCapture(task: TaskCatalogItem, invocation: TaskInvocation, files: WorkspaceFiles): Promise<CompilerScopeCapture | undefined> {
  if (task.kind !== "typecheck") return undefined;
  const cwd = resolve(files.root, task.cwd);
  let reason: string | undefined, version: string | undefined, identity: string | undefined;
  const manifestPath = join(cwd, "package.json"), compilerRoot = join(cwd, "node_modules/typescript");
  const identities = async () => Promise.all([manifestPath, join(compilerRoot, "package.json"), join(compilerRoot, "bin/tsc"), join(compilerRoot, "lib/_tsc.js")].map(path => readFile(path).then(sha256)));
  try {
    if (task.package_manager !== "npm" || task.invocation || !task.script ||
      !/^(?:tsc|node[ \t]+(?:\.\/)?node_modules\/typescript\/bin\/tsc)[ \t]+--noEmit(?:[ \t]+(?:-p|--project)[ \t]+[A-Za-z0-9_./-]+)?$/u.test(task.command.trim()))
      throw new Error("Only literal local npm TypeScript no-emit tasks support file reporting.");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.scripts?.[task.script] !== task.command || manifest.scripts?.[`pre${task.script}`] || manifest.scripts?.[`post${task.script}`])
      throw new Error("Lifecycle hooks or a changed script leave compiler file scope unknown.");
    const pkg = JSON.parse(await readFile(join(compilerRoot, "package.json"), "utf8"));
    if (pkg.name !== "typescript" || !/^5\.[7-9]\.\d+$/u.test(pkg.version))
      throw new Error("Installed compiler version is outside the supported reporting range.");
    if (task.command.trim().startsWith("tsc ") && await realpath(join(cwd, "node_modules/.bin/tsc")) !== await realpath(join(compilerRoot, "bin/tsc")))
      throw new Error("The local tsc executable does not identify this compiler.");
    version = pkg.version;
    identity = sha256((await identities()).join("\n"));
  } catch (error) {
    reason = error instanceof Error ? error.message : "Compiler identity unavailable.";
  }
  const supported = !reason;
  return {
    // --listFiles still checks types; --listFilesOnly would skip that validation.
    invocation: supported ? { ...invocation, args: [...invocation.args, "--", "--listFiles", "--pretty", "false"] } : invocation,
    async observe(result, snapshot, changedPaths, sourceRevisionId) {
      const lines = result.all.split(/\r?\n/u);
      const listing = supported ? lines.filter(line => isAbsolute(line) && /\.(?:[cm]?[jt]sx?)$/u.test(line)) : [];
      const listedLines = new Set(listing);
      const indexed = new Set(snapshot.files);
      const reported = [...new Set(listing.map(path => relative(files.root, path).replaceAll("\\", "/")).filter(path => indexed.has(path)))].sort();
      let unavailable = reason;
      if (supported && (!listing.length || result.failed || result.interruption)) unavailable = "Compiler listing is missing, failed or interrupted; no passing file scope is established.";
      if (supported && await identities().then(values => sha256(values.join("\n")) !== identity, () => true)) unavailable = "Compiler identity or package script changed during the invocation.";
      const stale = snapshot.revision.source_revision_id !== sourceRevisionId;
      const status = stale ? "stale" : unavailable ? "unknown" : "reported";
      const changed = [...new Set(changedPaths)].sort();
      const bounded = changed.slice(0, 20), paths = new Set(reported);
      const report: CompilerScopeReport = {
        status, basis: "typescript_listFiles", sourceRevisionId,
        ...(version ? { compilerVersion: version, compilerIdentity: identity } : {}),
        ...(status === "reported" ? { reportedWorkspaceFiles: reported.length, reportedPathsSha256: sha256(reported.join("\n")) } : {}),
        changedFilesReported: status === "reported" ? bounded.filter(path => paths.has(path)) : [],
        changedFilesNotReported: status === "reported" ? bounded.filter(path => !paths.has(path)) : [],
        changedFilesUnknown: status === "reported" ? [] : bounded,
        changedFilesTotal: changed.length, omittedChangedFiles: changed.length - bounded.length,
        ...(unavailable || stale ? { reason: stale ? "Source changed during compilation; this listing is stale." : unavailable } : {}),
        guidance: "Compiler-reported file membership only, not runtime tests, admitted source verification or user acceptance. Changed files not reported (including added tests or extra files) need a relevant check or an explicit coverage limitation. Unknown is not checked. This report does not widen the project or run another command.",
      };
      // Strip only the listing added by this adapter, keeping normal diagnostics.
      return { output: supported ? lines.filter(line => !listedLines.has(line)).join("\n") : result.all, report };
    },
  };
}
