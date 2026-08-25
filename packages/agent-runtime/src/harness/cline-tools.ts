import { createTool, type AgentTool, type AgentToolContext } from "@cline/sdk";
import { z } from "zod";
import { redactSecurityValue } from "../security-secret-redaction.js";
import { HarnessCostGovernor } from "./cost-governor.js";
import { ConversationMemoryStore } from "./conversation-memory.js";
import { harnessFeatureEnabled } from "./harness-feature-flags.js";
import { harnessError } from "./protocol.js";
import {
  applyChangeInputSchema,
  editCodeInputSchema,
  formatSchemaError,
  getRelationContextInputSchema,
  inspectArtifactInputSchema,
  inspectCodeInputSchema,
  inspectRunInputSchema,
  outlineCodeInputSchema,
  recallContextInputSchema,
  reviewChangeInputSchema,
  runTaskInputSchema,
  searchCodeInputSchema,
  workspaceStateInputSchema,
  validateChangeInputSchema,
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
  governorBudget?: number;
};

export function semanticWorkspaceTools(
  workspaceRoot?: string,
  options: SemanticWorkspaceToolsOptions = {},
): AgentTool[] {
  if (!workspaceRoot) return [];
  const executor =
    options.executor ??
    localSemanticWorkspaceExecutor(workspaceRoot, options.taskContract);
  const governor = new HarnessCostGovernor(options.governorBudget);
  const execute = async (
    tool: SemanticWorkspaceToolName,
    input: unknown,
    context: AgentToolContext,
  ) => {
    const contextEpoch = await activeContextEpoch(
      workspaceRoot,
      options.taskContract?.session_id,
      context,
    );
    const blocked = harnessFeatureEnabled("BLAME_COST_GOVERNOR_V2")
      ? governor.before(tool, contextEpoch)
      : undefined;
    if (blocked) return blocked;
    const result = await executor(
      {
        input,
        taskContract: options.taskContract,
        tool,
        ...(context.sessionId || context.toolCallId || contextEpoch
          ? {
              toolContext: {
                ...(contextEpoch ? { contextEpoch } : {}),
                ...(context.sessionId ? { sessionId: context.sessionId } : {}),
                ...(context.toolCallId
                  ? { toolCallId: context.toolCallId }
                  : {}),
              },
            }
          : {}),
        workspaceRoot,
      } satisfies SemanticWorkspaceExecutionRequest,
      context.signal,
    );
    return harnessFeatureEnabled("BLAME_COST_GOVERNOR_V2")
      ? governor.after(tool, input, result, {
          ...context,
          contextEpoch,
          conversationId: options.taskContract?.session_id,
        })
      : result;
  };
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
        "Search the current workspace using ripgrep text search, syntax symbols, or an ast-grep pattern. source_revision_id is optional and stale global revisions are rebased internally. Use this to obtain node_ref or symbol_ref handles before inspect_code or edit_code.",
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
        "Return a progressive syntax outline for a file or directory at the current revision. source_revision_id is optional. Each item returns one compact semantic symbol_ref accepted by inspect_code and edit_code.",
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
        "Inspect a symbol or node with automatic semantic rebase, or read a raw file fallback. source_revision_id is optional. Returns explicitly positioned segments, requested and resolved references, current revision, rebase strategy, overlap, and omissions.",
      schema: inspectCodeInputSchema,
      execute: (input, context) =>
        visibleResult(
          execute("inspect_code", input, context),
          options.redactSensitiveContent,
        ),
    }),
    createHarnessTool({
      name: "get_relation_context",
      description:
        "Return bounded calls, imports, implementations, reads, writes, references, and tests for a symbol_ref. Stale references are rebased internally before TypeScript compiler analysis or the bounded lexical fallback.",
      schema: getRelationContextInputSchema,
      execute: (input, context) =>
        visibleResult(
          execute("get_relation_context", input, context),
          options.redactSensitiveContent,
        ),
    }),
    createHarnessTool({
      name: "recall_context",
      description:
        "Recall one compact functional-memory slice by query, file, symbol, or exact change receipt. Active authoritative facts rank first; superseded facts are included only when requested or relevant to a previous-state query. maximum_tokens is a hard result bound. Returns no raw tool output or full diff.",
      schema: recallContextInputSchema,
      execute: (input, context) =>
        visibleResult(
          execute("recall_context", input, context),
          options.redactSensitiveContent,
        ),
    }),
    createHarnessTool({
      name: "edit_code",
      description:
        "Apply one atomic batch with replace_symbol, replace_body, replace_signature, insert, delete_symbol, AST-based CSS declarations, create/move, or patch_file. The runtime resolves moved targets and shifted patches, refuses close candidates, validates parsing, and returns a compact receipt.",
      schema: editCodeInputSchema,
      execute: (input, context) => execute("edit_code", input, context),
      retryable: false,
    }),
    ...(options.legacyMutationTools
      ? [
          createHarnessTool({
            name: "apply_change",
            description:
              "Legacy protocol v1 transactional change executor. Available only when the legacy harness feature flag is enabled.",
            schema: applyChangeInputSchema,
            execute: (input, context) =>
              execute("apply_change", input, context),
            retryable: false,
          }),
        ]
      : []),
    createHarnessTool({
      name: "run_task",
      description:
        "Run one known root or package workspace task against an exact source revision in an ephemeral filesystem overlay. Use a task_id from workspace_state, or an unambiguous test/lint/build/typecheck kind and package target. The runtime reports whether network denial is enforced by bubblewrap/sandbox-exec or only isolated by the story worktree. CPU and memory requests are accepted as hints and explicitly reported as ignored until a container adapter enforces them. Returns a revision-bound RunRef, diagnostics, logs, and filesystem effects without writing the canonical worktree.",
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
        "Review an immutable change proposal without mutating source or running checks. Returns a bounded textual diff, semantic symbol changes, exact-revision runs, diagnostics, and missing checks. Request impact only for cross-file changes; it is computed on demand and reports heuristic coverage.",
      schema: reviewChangeInputSchema,
      execute: (input, context) =>
        visibleResult(
          execute("review_change", input, context),
          options.redactSensitiveContent,
        ),
    }),
    createHarnessTool({
      name: "validate_change",
      description:
        "Build a compact evidence bundle for one committed proposal from parse diagnostics and exact-source-revision runs. Use after relevant run_task calls. Criteria are verified only when every declared required check passed; missing or unsupported evidence remains explicit. This tool does not rerun checks.",
      schema: validateChangeInputSchema,
      execute: (input, context) =>
        visibleResult(
          execute("validate_change", input, context),
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

async function activeContextEpoch(
  workspaceRoot: string,
  sessionId: string | undefined,
  context: AgentToolContext,
) {
  const explicit = context.metadata?.contextEpoch;
  if (typeof explicit === "string" && explicit) return explicit;
  if (sessionId && harnessFeatureEnabled("BLAME_CONTEXT_EPOCHS"))
    return new ConversationMemoryStore(
      workspaceRoot,
      sessionId,
    ).currentEpochId();
  const firstMessageId = context.snapshot?.messages[0]?.id;
  if (firstMessageId)
    return `${context.conversationId ?? context.sessionId ?? "context"}:${firstMessageId}`;
  return context.runId ?? context.conversationId;
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
