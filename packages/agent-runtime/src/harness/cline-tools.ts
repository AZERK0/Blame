import { createTool, type AgentTool, type AgentToolContext } from "@cline/sdk";
import { z } from "zod";
import { redactSecurityValue } from "../security-secret-redaction.js";
import { HarnessCostGovernor } from "./cost-governor.js";
import { ConversationMemoryStore } from "./conversation-memory.js";
import { harnessFeatureEnabled } from "./harness-feature-flags.js";
import { harnessError } from "./protocol.js";
import {
  applyChangeInputSchema,
  createFileInputSchema,
  deleteFileInputSchema,
  editCodeInputSchema,
  editFilesInputSchema,
  editJsonInputSchema,
  editSymbolInputSchema,
  formatSchemaError,
  getRelationContextInputSchema,
  inspectArtifactInputSchema,
  inspectCodeInputSchema,
  inspectRunInputSchema,
  outlineCodeInputSchema,
  moveFileInputSchema,
  patchFileInputSchema,
  recallContextInputSchema,
  replaceFileInputSchema,
  reviewChangeInputSchema,
  runTaskInputSchema,
  searchCodeInputSchema,
  workspaceStateInputSchema,
  validateChangeInputSchema,
} from "./schemas.js";
import { supportedOperationsDescription } from "./language-capabilities.js";
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
  const supportedOperations = supportedOperationsDescription();
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
      ? governor.before(tool, contextEpoch, input)
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
        "Read the canonical Blame workspace state, task catalog, changed paths, tree summary, and capability registry. Semantic reads and edits resolve the current revision themselves; use this tool when repository or task metadata is needed. Read-only; do not use it to inspect file contents.",
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
        "Search the current workspace using ripgrep text search, syntax symbols, or an ast-grep pattern. Text results expose matched_text and context separately, return a relocatable match_ref for the exact matched bytes, and include a node_ref only when a real enclosing AST node exists. source_revision_id is optional and stale references are rebased internally.",
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
      description: `Inspect a symbol, AST node, or lexical match with automatic rebase, or read a raw file fallback. The raw view is valid for references and paths. Returns language capabilities and the recommended edit tool.\n\n${supportedOperations}`,
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
      name: "edit_symbol",
      description: `Replace one semantic symbol without offsets, hashes, or revisions. The runtime relocates the symbol, validates the resulting syntax, and returns its new reference.\n\n${supportedOperations}`,
      schema: editSymbolInputSchema,
      execute: (input, context) => execute("edit_symbol", input, context),
      retryable: false,
    }),
    createHarnessTool({
      name: "edit_json",
      description: `Apply structured set, delete, merge, or append operations to one JSON or JSONC file while preserving comments and formatting.\n\n${supportedOperations}`,
      schema: editJsonInputSchema,
      execute: (input, context) => execute("edit_json", input, context),
      retryable: false,
    }),
    createHarnessTool({
      name: "patch_file",
      description: `Apply a recoverable patch to exactly one text file. Multi-file patches are rejected before any workspace change.\n\n${supportedOperations}`,
      schema: patchFileInputSchema,
      execute: (input, context) => execute("patch_file", input, context),
      retryable: false,
    }),
    createHarnessTool({
      name: "edit_files",
      description: `Apply and syntax-validate file operations independently by file by default. Use atomicity strict only when every file is part of one coupled transaction; then no file is written when validation fails.\n\n${supportedOperations}`,
      schema: editFilesInputSchema,
      execute: (input, context) => execute("edit_files", input, context),
      retryable: false,
    }),
    createHarnessTool({
      name: "create_file",
      description:
        "Create one text file atomically and validate its syntax when supported.",
      schema: createFileInputSchema,
      execute: (input, context) => execute("create_file", input, context),
      retryable: false,
    }),
    createHarnessTool({
      name: "replace_file",
      description:
        "Replace one text file atomically and report passed, failed, or not-supported validation without false positives.",
      schema: replaceFileInputSchema,
      execute: (input, context) => execute("replace_file", input, context),
      retryable: false,
    }),
    createHarnessTool({
      name: "delete_file",
      description:
        "Delete one file atomically. This is a real file deletion, not a symbol deletion.",
      schema: deleteFileInputSchema,
      execute: (input, context) => execute("delete_file", input, context),
      retryable: false,
    }),
    createHarnessTool({
      name: "move_file",
      description:
        "Move one file atomically and validate the content against the destination capability.",
      schema: moveFileInputSchema,
      execute: (input, context) => execute("move_file", input, context),
      retryable: false,
    }),
    createHarnessTool({
      name: "edit_code",
      description:
        "Compatibility editor for relocatable match_ref replacements, replace_body, replace_signature, insertion, symbol deletion, and CSS declarations. Independent files use per-file commits by default; set atomicity to strict only for coupled changes. Prefer specialized edit tools when available.",
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
