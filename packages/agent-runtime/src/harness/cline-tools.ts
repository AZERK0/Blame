import { createTool, type AgentTool, type AgentToolContext } from "@cline/sdk";
import { z } from "zod";
import { redactSecurityValue } from "../security-secret-redaction.js";
import { harnessError } from "./protocol.js";
import {
  applyChangeInputSchema,
  formatSchemaError,
  inspectArtifactInputSchema,
  inspectCodeInputSchema,
  inspectRunInputSchema,
  outlineCodeInputSchema,
  reviewChangeInputSchema,
  runTaskInputSchema,
  searchCodeInputSchema,
  workspaceStateInputSchema,
} from "./schemas.js";
import {
  localSemanticWorkspaceExecutor,
  semanticWorkspaceReadToolNames,
  semanticWorkspaceWriteToolNames,
  type SemanticWorkspaceExecutionRequest,
  type SemanticWorkspaceExecutor,
  type SemanticWorkspaceToolName,
} from "./semantic-executor.js";
import type { SemanticWorkspaceOptions } from "./semantic-workspace.js";

export { semanticWorkspaceReadToolNames, semanticWorkspaceWriteToolNames };

export type SemanticWorkspaceToolsOptions = SemanticWorkspaceOptions & {
  executor?: SemanticWorkspaceExecutor;
};

export function semanticWorkspaceTools(
  workspaceRoot?: string,
  options: SemanticWorkspaceToolsOptions = {},
): AgentTool[] {
  if (!workspaceRoot) return [];
  const executor =
    options.executor ??
    localSemanticWorkspaceExecutor(workspaceRoot, options.taskContract);
  const execute = (
    tool: SemanticWorkspaceToolName,
    input: unknown,
    context: AgentToolContext,
  ) =>
    executor(
      {
        input,
        taskContract: options.taskContract,
        tool,
        workspaceRoot,
      } satisfies SemanticWorkspaceExecutionRequest,
      context.signal,
    );
  return [
    createHarnessTool({
      name: "workspace_state",
      description:
        "Read the canonical Blame workspace state and obtain the current source_revision_id. Use this before semantic reads or edits, and again after STALE_REVISION. Returns Git/base state, changed paths, a compact tree/language summary, task catalog, and supported harness capabilities. Read-only; do not use it to inspect file contents.",
      schema: workspaceStateInputSchema,
      execute: (input, context) =>
        visibleResult(
          execute("workspace_state", input, context),
          options.redactSensitiveContent,
        ),
    }),
    createHarnessTool({
      name: "search_code",
      description:
        "Search one exact source revision using ripgrep text search, syntax symbols, or an ast-grep pattern. Use for localization and to obtain exact node_ref/symbol_ref handles before inspect_code or apply_change. Returns the engine, bounded matches, byte/line ranges, provenance, and explicit truncation. Do not use stale handles or use this as natural-language semantic search.",
      schema: searchCodeInputSchema,
      execute: (input, context) =>
        visibleResult(
          execute("search_code", input, context),
          options.redactSensitiveContent,
        ),
    }),
    createHarnessTool({
      name: "outline_code",
      description:
        "Return a progressive syntax outline for a file or directory at an exact source revision. Use before broad file reads to discover classes, functions, methods, interfaces, types, enums, and function-valued variables. Each item returns an exact revision-bound symbol_ref and node_ref. Unsupported files return parse-quality diagnostics; use inspect_code view raw as the fallback.",
      schema: outlineCodeInputSchema,
      execute: (input, context) =>
        visibleResult(
          execute("outline_code", input, context),
          options.redactSensitiveContent,
        ),
    }),
    createHarnessTool({
      name: "inspect_code",
      description:
        "Inspect one exact revision-bound symbol/node, or read a raw file fallback. Use symbol_ref/node_ref from search_code or outline_code for signature, declaration, body, interface, or neighborhood views. Use target.path only with view raw. Returns byte ranges, file hash/ref, omissions, provenance, and STALE_REVISION instead of silently rematching.",
      schema: inspectCodeInputSchema,
      execute: (input, context) =>
        visibleResult(
          execute("inspect_code", input, context),
          options.redactSensitiveContent,
        ),
    }),
    createHarnessTool({
      name: "apply_change",
      description:
        "Create or commit a transactional code change with compare-and-swap. First call action propose with the exact base source revision, immutable node/text/file operations, and an idempotency key. Review the immutable result, then call commit_proposal with the same base and a commit idempotency key. Never silently relocates stale targets; writes are locked across processes and crash-recoverable.",
      schema: applyChangeInputSchema,
      execute: (input, context) => execute("apply_change", input, context),
      retryable: false,
    }),
    createHarnessTool({
      name: "run_task",
      description:
        "Run one known workspace task against an exact source revision in an ephemeral filesystem overlay with default-deny networking. Use a task_id from workspace_state, or an unambiguous test/lint/build/typecheck kind. Returns a revision-bound RunRef, structured failures/diagnostics, encrypted log artifacts, and any filesystem effects as a separate immutable ChangeProposal; it never writes the canonical worktree. Do not use it for ad-hoc shell commands, dependency installation, or long-running services.",
      schema: runTaskInputSchema,
      execute: (input, context) => execute("run_task", input, context),
      retryable: false,
    }),
    createHarnessTool({
      name: "inspect_run",
      description:
        "Reopen one bounded view of an exact RunRef returned by run_task. Use it for failures, diagnostics, stdout/stderr head or tail, events, filesystem effects, or performance without rerunning the task. Complete redacted logs remain available through inspect_artifact.",
      schema: inspectRunInputSchema,
      execute: (input, context) =>
        visibleResult(
          execute("inspect_run", input, context),
          options.redactSensitiveContent,
        ),
    }),
    createHarnessTool({
      name: "review_change",
      description:
        "Review an immutable change proposal without mutating source or running checks. Use after apply_change propose and before commit_proposal. Returns textual diff, file hashes, syntax-symbol additions/removals, parse diagnostics, staleness, attached artifact, and checks not yet run.",
      schema: reviewChangeInputSchema,
      execute: (input, context) =>
        visibleResult(
          execute("review_change", input, context),
          options.redactSensitiveContent,
        ),
    }),
    createHarnessTool({
      name: "inspect_artifact",
      description:
        "Reopen an exact agent-visible artifact by ArtifactRef with a byte offset and output budget. Use for complete redacted logs, diffs, filesystem-effect manifests, or JSON evidence returned by another harness tool. Sealed raw and reviewer-only artifacts are policy-denied; omitted bytes and a continuation offset are explicit.",
      schema: inspectArtifactInputSchema,
      execute: (input, context) =>
        visibleResult(
          execute("inspect_artifact", input, context),
          options.redactSensitiveContent,
        ),
    }),
  ];
}

async function visibleResult<T>(
  result: Promise<T>,
  redactSensitiveContent = false,
) {
  const value = await result;
  return redactSensitiveContent ? redactSecurityValue(value) : value;
}

function createHarnessTool<TSchema extends z.ZodTypeAny>(input: {
  name: string;
  description: string;
  schema: TSchema;
  execute: (
    value: z.infer<TSchema>,
    context: AgentToolContext,
  ) => Promise<{ status: string }>;
  retryable?: boolean;
}): AgentTool {
  // CoreSessionConfig stores heterogeneous tools as AgentTool<unknown, unknown>.
  // Unknown input is still validated with the original Zod schema before the
  // typed canonical handler is invoked.
  return createTool<unknown, unknown>({
    name: input.name,
    description: input.description,
    inputSchema: input.schema as unknown as Record<string, unknown>,
    retryable: input.retryable ?? false,
    maxRetries: 0,
    async execute(raw: unknown, context: AgentToolContext) {
      const parsed = input.schema.safeParse(raw);
      if (!parsed.success)
        return {
          output: harnessError({
            code: "INVALID_INPUT",
            message: formatSchemaError(parsed.error),
          }),
          isError: true,
        };
      const result = await input.execute(parsed.data, context);
      return result.status === "error"
        ? { output: result, isError: true }
        : result;
    },
  });
}
