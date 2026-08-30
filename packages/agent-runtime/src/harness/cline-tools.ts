import { createTool, type AgentTool, type AgentToolContext } from "@cline/sdk";
import { isHarnessResult, type HarnessResult } from "@blame/harness-core";
import { z } from "zod";
import { redactSecurityValue } from "../security-secret-redaction.js";
import {
  HarnessCostGovernor,
  type BroadReadAdmission,
} from "./cost-governor.js";
import { ConversationMemoryStore } from "./conversation-memory.js";
import { harnessFeatureEnabled } from "./harness-feature-flags.js";
import {
  boundHarnessResult,
  harnessError,
  harnessSuccess,
  type HarnessToolResult,
} from "./protocol.js";
import {
  CanonicalResultMapper,
  projectCanonicalResultV2,
} from "./protocol-v3-adapter.js";
import {
  RecoveryController,
  type RetrySuppression,
} from "./recovery-controller.js";
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
  dependencyMutationInputSchema,
  patchFileInputSchema,
  recallContextInputSchema,
  replaceFileInputSchema,
  reviewChangeInputSchema,
  runTaskInputSchema,
  searchCodeInputSchema,
  workspaceStateInputSchema,
  validateChangeInputSchema,
} from "./schemas.js";
import {
  semanticInspectionExtensionsDescription,
  supportedOperationsDescription,
} from "./language-capabilities.js";
import {
  localSemanticWorkspaceExecutor,
  semanticWorkspaceReadToolNames,
  semanticWorkspaceWriteToolNames,
  type SemanticWorkspaceExecutionRequest,
  type SemanticWorkspaceBridgeExecutor,
  type SemanticWorkspaceToolName,
} from "./semantic-executor.js";
import type { SemanticWorkspaceOptions } from "./semantic-workspace.js";
import { WorkspaceFiles } from "./workspace-files.js";
import {
  outlineReadProfile,
  rawReadLineProfile,
  rawReadRequest,
  rawReadSizeProfile,
  relationReadProfile,
  searchReadProfile,
} from "./code-navigation-policy.js";
import { semanticCallSignature } from "./semantic-loop-detector.js";
import { compactWorkspaceStateResult } from "./workspace-state-output.js";

export { semanticWorkspaceReadToolNames, semanticWorkspaceWriteToolNames };

export type SemanticWorkspaceToolsOptions = SemanticWorkspaceOptions & {
  executor?: SemanticWorkspaceBridgeExecutor;
  governor?: HarnessCostGovernor;
  governorBudget?: number;
  protocolVersion?: "2" | "3";
};

export function semanticWorkspaceTools(
  workspaceRoot?: string,
  options: SemanticWorkspaceToolsOptions = {},
): AgentTool[] {
  if (!workspaceRoot) return [];
  const executor =
    options.executor ??
    localSemanticWorkspaceExecutor(workspaceRoot, options.taskContract);
  const governor =
    options.governor ??
    new HarnessCostGovernor(
      options.governorBudget,
      harnessFeatureEnabled("BLAME_NATIVE_CLINE_HARNESS"),
    );
  const navigationFiles = new WorkspaceFiles(workspaceRoot);
  const canonicalMapper = new CanonicalResultMapper();
  const recoveryController = new RecoveryController(navigationFiles);
  const createHarnessTool = <TSchema extends z.ZodTypeAny>(
    input: HarnessToolDefinition<TSchema>,
  ) =>
    buildHarnessTool(input, {
      environmentFingerprint: (context) =>
        recoveryController.environmentFingerprint(context),
      mapper: canonicalMapper,
      protocolVersion: options.protocolVersion ?? "2",
      recoveryController,
    });
  let broadReadSequence = 0;
  const supportedOperations = supportedOperationsDescription();
  const semanticExtensions = semanticInspectionExtensionsDescription();
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
    const governed =
      (options.protocolVersion ?? "2") === "2" &&
      harnessFeatureEnabled("BLAME_COST_GOVERNOR_V2");
    const reservationId = `${
      context.toolCallId ?? context.runId ?? "read"
    }:${broadReadSequence++}`;
    const admission = governed
      ? await broadReadAdmission(navigationFiles, tool, input, reservationId)
      : undefined;
    const blocked = governed
      ? governor.before(tool, contextEpoch, input, context.iteration, admission)
      : undefined;
    if (blocked) return blocked;
    try {
      const delegated = await executor(
        executionRequest(
          workspaceRoot,
          options.taskContract,
          tool,
          input,
          context,
          contextEpoch,
        ),
        context.signal,
      );
      const result = normalizeDelegatedResult(delegated, tool);
      const observed = governed
        ? governor.after(tool, input, legacyResult(result), {
            ...context,
            contextEpoch,
            conversationId: options.taskContract?.session_id,
          })
        : result;
      await recordReadKnowledge(
        workspaceRoot,
        options.taskContract?.session_id,
        tool,
        observed,
      );
      return observed;
    } finally {
      governor.releaseBroadRead(admission?.reservationId);
    }
  };
  return [
    createHarnessTool({
      name: "workspace_state",
      description:
        "Refresh the canonical Blame workspace state, changed paths, tree summary, and capability registry when the initial task_briefing lacks required metadata or the workspace changed. The default receipt includes every package and manifest path, relevant dependencies, important tasks, and short revision-bound cursors for exhaustive pages. Omit cursor for the current state; reuse only an exact next_cursor emitted by the latest response and never fabricate or encode one. Semantic reads and edits resolve the current revision themselves. Read-only; do not use it to inspect file contents or rediscover an unchanged task_briefing.",
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
        "Use when the relevant file or symbol location is unknown or absent from the initial task_briefing. Search the current workspace with a narrow path or language scope using text, syntax symbols, or an ast-grep pattern. Results return relocatable references for targeted inspection; do not use repeated broad searches after the target is known or reconstruct dependency APIs from lockfiles.",
      schema: searchCodeInputSchema,
      execute: (input, context) =>
        visibleResult(
          execute("search_code", input, context),
          options.redactSensitiveContent,
        ),
    }),
    createHarnessTool({
      name: "outline_code",
      description: `Return a progressive syntax outline for one supported file or a narrow directory. Directory targets must stay small and specific. Each item returns a compact symbol_ref accepted by inspect_code and edit_code. Supported semantic extensions: ${semanticExtensions}.`,
      schema: outlineCodeInputSchema,
      execute: (input, context) =>
        visibleResult(
          execute("outline_code", input, context),
          options.redactSensitiveContent,
        ),
    }),
    createHarnessTool({
      name: "inspect_code",
      description: `Inspect one symbol_ref, AST node, or lexical match with automatic rebase. A path with raw view reads the requested content directly when it fits max_output_tokens; otherwise the runtime returns a semantic outline or bounded preview without a failed call. Inspect installed dependency source only for a concrete declaration that workspace_state confirms exists. Supported semantic extensions: ${semanticExtensions}. Returns language capabilities and the recommended edit tool.\n\n${supportedOperations}`,
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
      description: `Apply and syntax-validate file operations. Use insert_text at start or end for file-level imports, headers, or append-only sections that do not need an anchor. The runtime automatically groups operations that touch the same paths and commits unrelated files independently.\n\n${supportedOperations}`,
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
        "Compatibility editor for relocatable match_ref replacements, replace_body, replace_signature, insertion, symbol deletion, and CSS declarations. The runtime automatically groups coupled paths and commits unrelated files independently. Prefer specialized edit tools when available.",
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
      name: "mutate_dependencies",
      description:
        "Use only when workspace_state reports dependency_mutation.status=available. When available, add or remove package.json dependencies through the native workflow and atomically regenerate the lockfile. When unavailable, the tool is non-executable and returns compact alternatives without an executor call. Never edit lockfiles with edit tools.",
      schema: dependencyMutationInputSchema,
      execute: (input, context) =>
        execute("mutate_dependencies", input, context),
      retryable: false,
    }),
    createHarnessTool({
      name: "run_task",
      description:
        "Run one known root or package workspace task against an exact source revision in an ephemeral filesystem overlay. Prefer an exact task_id from the latest workspace_state; never invent a validation task that is absent from its catalog. An infrastructure_error is a runtime limitation: never edit project manifests, scripts, lockfiles, or source to repair it, and never replay the same task until the runtime changes. The runtime reports whether network denial is enforced by bubblewrap/sandbox-exec or only isolated by the story worktree. CPU and memory requests are accepted as hints and explicitly reported as ignored until a container adapter enforces them. Returns a revision-bound RunRef, diagnostics, logs, and filesystem effects without writing the canonical worktree.",
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

async function recordReadKnowledge(
  workspaceRoot: string,
  conversationId: string | undefined,
  tool: SemanticWorkspaceToolName,
  result: SemanticWorkspaceExecutionResult,
) {
  if (
    !conversationId ||
    (!isHarnessResult(result) && result.status !== "success") ||
    !knowledgeReadTools.includes(tool)
  )
    return;
  const data = recordValue(result.data);
  const paths = discoveredPaths(data).slice(0, 6);
  const symbols = discoveredSymbols(data).slice(0, 6);
  const facts = [
    ...(paths.length ? [`${tool} located: ${paths.join(", ")}.`] : []),
    ...(symbols.length
      ? [`${tool} identified symbols: ${symbols.join(", ")}.`]
      : []),
  ];
  await new ConversationMemoryStore(workspaceRoot, conversationId)
    .recordKnowledge(facts)
    .catch(() => undefined);
}

const knowledgeReadTools: readonly SemanticWorkspaceToolName[] = [
  "get_relation_context",
  "inspect_code",
  "outline_code",
  "search_code",
];

function discoveredPaths(value: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (Array.isArray(value))
    return value.flatMap((entry) => discoveredPaths(entry, depth + 1));
  const record = recordValue(value);
  return uniqueStrings([
    ...(typeof record.path === "string" ? [record.path] : []),
    ...Object.values(record).flatMap((entry) =>
      discoveredPaths(entry, depth + 1),
    ),
  ]).filter((path) => /(?:^|\/)\.?[\w@-]+(?:\/[\w@.-]+)+$/u.test(path));
}

function discoveredSymbols(value: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (Array.isArray(value))
    return value.flatMap((entry) => discoveredSymbols(entry, depth + 1));
  const record = recordValue(value);
  return uniqueStrings([
    ...[record.qualified_name, record.symbol, record.name].filter(
      (entry): entry is string => typeof entry === "string",
    ),
    ...Object.values(record).flatMap((entry) =>
      discoveredSymbols(entry, depth + 1),
    ),
  ]).filter((symbol) => symbol.length <= 160);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function executionRequest(
  workspaceRoot: string,
  taskContract: SemanticWorkspaceOptions["taskContract"],
  tool: SemanticWorkspaceToolName,
  input: unknown,
  context: AgentToolContext,
  contextEpoch?: string,
): SemanticWorkspaceExecutionRequest {
  const hasContext = context.sessionId || context.toolCallId || contextEpoch;
  return {
    input,
    taskContract,
    tool,
    ...(hasContext
      ? {
          toolContext: {
            ...(contextEpoch ? { contextEpoch } : {}),
            ...(context.sessionId ? { sessionId: context.sessionId } : {}),
            ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
          },
        }
      : {}),
    workspaceRoot,
  };
}

async function broadReadAdmission(
  files: WorkspaceFiles,
  tool: SemanticWorkspaceToolName,
  input: unknown,
  reservationId: string,
): Promise<BroadReadAdmission | undefined> {
  try {
    const profile = await toolReadProfile(files, tool, input);
    return profile?.broad
      ? {
          ...profile,
          reservationId,
          signature: `${
            (await files.snapshot()).revision.source_revision_id
          }:${semanticCallSignature(tool, input)}`,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

async function toolReadProfile(
  files: WorkspaceFiles,
  tool: SemanticWorkspaceToolName,
  input: unknown,
) {
  if (tool === "search_code") return searchReadProfile(input);
  if (tool === "get_relation_context") return relationReadProfile(input);
  if (tool === "outline_code") {
    const path = inputTargetPath(input);
    return path
      ? outlineReadProfile(input, await files.pathProfile(path))
      : undefined;
  }
  if (tool !== "inspect_code") return undefined;
  const request = rawReadRequest(input);
  if (!request) return undefined;
  const size = await files.fileSize(request.path);
  const sizeProfile = rawReadSizeProfile(size, request.range);
  if (sizeProfile.broad) return sizeProfile;
  if (!sizeProfile.requestedRange) return undefined;
  return rawReadLineProfile(
    sizeProfile,
    await files.readRange(request.path, sizeProfile.requestedRange),
  );
}

function inputTargetPath(input: unknown) {
  if (!input || typeof input !== "object") return undefined;
  const target = (input as { target?: unknown }).target;
  if (!target || typeof target !== "object") return undefined;
  const path = (target as { path?: unknown }).path;
  return typeof path === "string" && path.trim() ? path.trim() : undefined;
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

type HarnessToolDefinition<TSchema extends z.ZodTypeAny> = {
  name: SemanticWorkspaceToolName;
  description: string;
  schema: TSchema;
  execute: (
    value: z.infer<TSchema>,
    context: AgentToolContext,
  ) => Promise<SemanticWorkspaceExecutionResult>;
  retryable?: boolean;
};

type HarnessProtocol = {
  environmentFingerprint(context: AgentToolContext): string;
  mapper: CanonicalResultMapper;
  protocolVersion: "2" | "3";
  recoveryController: RecoveryController;
};

function buildHarnessTool<TSchema extends z.ZodTypeAny>(
  input: HarnessToolDefinition<TSchema>,
  protocol: HarnessProtocol,
): AgentTool {
  return createTool<unknown, unknown>({
    name: input.name,
    description: input.description,
    inputSchema: input.schema as unknown as Record<string, unknown>,
    retryable: input.retryable ?? false,
    maxRetries: 0,
    async execute(raw: unknown, context: AgentToolContext) {
      const retrySuppression =
        protocol.protocolVersion === "3"
          ? await protocol.recoveryController.before(input.name, raw, context)
          : undefined;
      if (retrySuppression)
        return mapCanonicalResult(
          retrySuppressedResult(retrySuppression),
          input.name,
          context,
          protocol,
        );
      const parsed = input.schema.safeParse(raw);
      if (!parsed.success)
        return publishToolResult(
          harnessError({
            code: "INVALID_INPUT",
            message: formatSchemaError(parsed.error),
          }),
          raw,
          input.name,
          context,
          protocol,
        );
      const executed = await input.execute(parsed.data, context);
      if (isHarnessResult(executed))
        return publishCanonicalResult(
          prepareCanonicalResult(executed, input.name, parsed.data),
          parsed.data,
          input.name,
          context,
          protocol,
        );
      const maximumTokens = requestedOutputTokens(input.name, parsed.data);
      const prepared =
        input.name === "workspace_state"
          ? compactWorkspaceStateResult(
              executed,
              workspaceStateInclude(parsed.data),
              workspaceStatePage(parsed.data),
              maximumTokens,
            )
          : executed;
      const result = boundHarnessResult(prepared, maximumTokens);
      return publishToolResult(
        result,
        parsed.data,
        input.name,
        context,
        protocol,
      );
    },
  });
}

function prepareCanonicalResult(
  result: HarnessResult<unknown, unknown>,
  tool: SemanticWorkspaceToolName,
  input: unknown,
): HarnessResult<unknown, unknown> {
  const maximumTokens = requestedOutputTokens(tool, input);
  const projected = projectCanonicalResultV2(result);
  const prepared =
    tool === "workspace_state"
      ? compactWorkspaceStateResult(
          projected,
          workspaceStateInclude(input),
          workspaceStatePage(input),
          maximumTokens,
        )
      : projected;
  const bounded = boundHarnessResult(prepared, maximumTokens);
  return bounded.status === "success"
    ? { ...result, data: bounded.data }
    : result;
}

type SemanticWorkspaceExecutionResult =
  | HarnessToolResult<unknown>
  | HarnessResult<unknown, unknown>;

function publishCanonicalResult(
  result: HarnessResult<unknown, unknown>,
  input: unknown,
  tool: SemanticWorkspaceToolName,
  context: AgentToolContext,
  protocol: HarnessProtocol,
) {
  if (protocol.protocolVersion === "2")
    return publishToolResult(
      projectCanonicalResultV2(result),
      input,
      tool,
      context,
      protocol,
    );
  protocol.recoveryController.observe(tool, input, context, result);
  return result;
}

function publishToolResult(
  result: HarnessToolResult<unknown>,
  input: unknown,
  tool: SemanticWorkspaceToolName,
  context: AgentToolContext,
  protocol: HarnessProtocol,
) {
  if (protocol.protocolVersion === "2")
    return result.status === "error"
      ? { output: result, isError: result.fatal }
      : result;
  const canonical = mapCanonicalResult(result, tool, context, protocol);
  protocol.recoveryController.observe(tool, input, context, canonical);
  return canonical;
}

function mapCanonicalResult(
  result: HarnessToolResult<unknown>,
  tool: SemanticWorkspaceToolName,
  context: AgentToolContext,
  protocol: HarnessProtocol,
) {
  return protocol.mapper.map(
    result,
    canonicalToolContext(
      tool,
      context,
      protocol.environmentFingerprint(context),
    ),
  );
}

function canonicalToolContext(
  tool: string,
  context: AgentToolContext,
  environmentFingerprint?: string,
) {
  return {
    executionId:
      context.runId ??
      context.sessionId ??
      context.conversationId ??
      "cline-execution",
    ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
    ...(environmentFingerprint ? { environmentFingerprint } : {}),
    tool,
  };
}

function retrySuppressedResult(input: RetrySuppression) {
  const revision = input.sourceRevisionId
    ? { source_revision_id: input.sourceRevisionId }
    : {};
  return harnessSuccess({
    data: {
      status: "retry_suppressed",
      recovery: input.recovery,
      postcondition_satisfied: false,
    },
    revision,
    startedAt: Date.now(),
    provenance: [],
    outcome: "blocked",
    reason: "RECOVERY_CONDITION_NOT_SATISFIED",
    recommendation: `Retry only when ${input.recovery.condition} is satisfied.`,
  });
}

function normalizeHarnessToolResult(
  value: unknown,
  tool: SemanticWorkspaceToolName,
): HarnessToolResult<unknown> {
  const envelope = recordValue(value);
  const status = envelope.status;
  const commonValid =
    typeof envelope.protocol_version === "string" &&
    typeof envelope.tool_schema_version === "string" &&
    typeof envelope.reason === "string" &&
    typeof envelope.recommendation === "string";
  const successValid =
    status === "success" &&
    commonValid &&
    envelope.fatal === false &&
    ["applied", "blocked", "completed", "skipped", "unavailable"].includes(
      String(envelope.outcome),
    ) &&
    Object.hasOwn(envelope, "data") &&
    isRecord(envelope.subject_revision) &&
    Array.isArray(envelope.provenance) &&
    isRecord(envelope.coverage) &&
    isRecord(envelope.usage);
  const errorValid =
    status === "error" &&
    commonValid &&
    envelope.outcome === "failed" &&
    typeof envelope.fatal === "boolean" &&
    isRecord(envelope.error);
  if (successValid || errorValid) return value as HarnessToolResult<unknown>;
  return harnessError({
    code: "EXECUTION_ERROR",
    message: `The delegated ${tool} executor returned an invalid harness envelope.`,
    recommendation:
      "Retry only after the executor IPC contract is healthy; other tools may continue.",
  });
}

function normalizeDelegatedResult(
  value: unknown,
  tool: SemanticWorkspaceToolName,
): SemanticWorkspaceExecutionResult {
  return isHarnessResult(value)
    ? value
    : normalizeHarnessToolResult(value, tool);
}

function legacyResult(
  value: SemanticWorkspaceExecutionResult,
): HarnessToolResult<unknown> {
  return isHarnessResult(value) ? projectCanonicalResultV2(value) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function workspaceStatePage(value: unknown) {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    cursor: normalizedWorkspaceStateCursor(input.cursor),
    pageSize: typeof input.page_size === "number" ? input.page_size : undefined,
  };
}

function normalizedWorkspaceStateCursor(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return ["0", "none", "null", "undefined"].includes(normalized.toLowerCase())
    ? undefined
    : normalized;
}

function workspaceStateInclude(value: unknown) {
  const include =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).include
      : undefined;
  return Array.isArray(include)
    ? include.filter((entry): entry is string => typeof entry === "string")
    : undefined;
}

function requestedOutputTokens(tool: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return tool === "workspace_state" ? 8_000 : undefined;
  const input = value as Record<string, unknown>;
  const budget = input.budget;
  if (budget && typeof budget === "object" && !Array.isArray(budget)) {
    const requested = (budget as Record<string, unknown>).max_output_tokens;
    if (typeof requested === "number") return requested;
  }
  if (typeof input.maximum_tokens === "number") return input.maximum_tokens;
  return tool === "workspace_state" ? 8_000 : undefined;
}
