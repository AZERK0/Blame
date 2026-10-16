import { readFile, realpath, stat } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { sha256 } from "./light-identity.js";
import {
  semanticReferenceLimits,
  type ReferenceFootprint,
  type SemanticReferenceReply,
  type SemanticReferenceRequest,
  type DependencyDeclarationRequest,
  type DependencyDeclarationReply,
} from "./semantic-reference-types.js";

export async function querySemanticReferences(
  request: SemanticReferenceRequest,
  signal?: AbortSignal,
  timeoutMs: number = semanticReferenceLimits.timeoutMs,
): Promise<SemanticReferenceReply> {
  return queryCompiler<SemanticReferenceReply>(request, signal, timeoutMs);
}

export async function queryDependencyDeclaration(
  request: DependencyDeclarationRequest,
  signal?: AbortSignal,
  timeoutMs: number = semanticReferenceLimits.timeoutMs,
): Promise<DependencyDeclarationReply> {
  return queryCompiler<DependencyDeclarationReply>(request, signal, timeoutMs);
}

async function queryCompiler<T extends { status: string }>(
  request: SemanticReferenceRequest | DependencyDeclarationRequest,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  signal?.throwIfAborted();
  const worker = new Worker(
    new URL("./semantic-reference-worker.js", import.meta.url),
    {
      workerData: request,
      resourceLimits: {
        maxOldGenerationSizeMb: semanticReferenceLimits.workerHeapMb,
      },
      // Strip host test/loader arguments; workers execute the packaged JS module.
      execArgv: [],
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      const unavailable = (reason: string) => resolve({ status: "unavailable", reason } as unknown as T);
      onAbort = () =>
        reject(signal?.reason ?? new Error("Reference query cancelled"));
      signal?.addEventListener("abort", onAbort, { once: true });
      worker.once("message", resolve);
      worker.once("error", () =>
        unavailable("worker_failed"),
      );
      worker.once("exit", () =>
        unavailable("worker_exited"),
      );
      timer = setTimeout(
        () => unavailable("query_timeout"),
        timeoutMs,
      );
      if (signal?.aborted) onAbort();
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    await worker.terminate();
  }
}

export async function referenceFootprintIsCurrent(
  footprint: ReferenceFootprint,
  signal?: AbortSignal,
) {
  // Bounded batches keep file-descriptor pressure independent of project size.
  const checks = [
    ...(footprint.realpaths ?? []).map(({ path, resolved }) => async () => {
      try { return await realpath(path) === resolved; } catch { return false; }
    }),
    ...footprint.reads.map(({ path, hash }) => async () => {
      try {
        return sha256(await readFile(path)) === hash;
      } catch {
        return false;
      }
    }),
    ...footprint.existence.map(({ path, exists }) => async () => {
      try {
        return (await stat(path)).isFile() === exists;
      } catch {
        return !exists;
      }
    }),
  ];
  for (let index = 0; index < checks.length; index += 32) {
    signal?.throwIfAborted();
    if (
      (
        await Promise.all(
          checks.slice(index, index + 32).map((check) => check()),
        )
      ).some((current) => !current)
    )
      return false;
  }
  return true;
}
