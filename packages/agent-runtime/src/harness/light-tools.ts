import { createTool, type AgentTool, type AgentToolContext } from "@cline/sdk";
import { z } from "zod";
import { redactSecurityValue } from "../security-secret-redaction.js";
import type { PreviewDependencyRefreshResult } from "../preview-harness-tools.js";
import {
  lightEditCodeInputSchema,
  lightReadCodeInputSchema,
  lightRunTaskInputSchema,
  lightSearchCodeInputSchema,
  type LightToolResult,
  type LightTaskContract,
} from "./light-contracts.js";
import { lightCapabilityDescription } from "./light-capabilities.js";
import type {
  LightToolContext,
  LightWorkspaceExecutor,
  LightWorkspaceToolName,
} from "./light-executor.js";
import { lightToolContext } from "./light-executor.js";
import { LightWorkspace } from "./light-workspace.js";

export const lightReadToolNames = ["search_code", "read_code"] as const;
export const lightWriteToolNames = ["edit_code", "run_task"] as const;

export type LightHarnessToolsOptions = {
  executor?: LightWorkspaceExecutor;
  refreshPreviewDependencies?: () => Promise<PreviewDependencyRefreshResult>;
  taskContract?: LightTaskContract;
};

export function lightSemanticHarnessTools(
  workspaceRoot?: string,
  options: LightHarnessToolsOptions = {},
): AgentTool[] {
  if (!workspaceRoot) return [];
  const workspace = options.executor
    ? executorWorkspace(workspaceRoot, options)
    : new LightWorkspace(workspaceRoot, {
        refreshPreviewDependencies: options.refreshPreviewDependencies,
        sessionId: options.taskContract?.session_id ?? "unscoped-session",
        taskContract: options.taskContract,
      });
  const capabilities = lightCapabilityDescription();
  return lightWorkspaceTools(workspace, capabilities);
}

type LightWorkspacePort = Pick<
  LightWorkspace,
  "editCode" | "readCode" | "runTask" | "searchCode"
>;

function executorWorkspace(
  workspaceRoot: string,
  options: LightHarnessToolsOptions,
): LightWorkspacePort {
  const invoke = executorInvocation(workspaceRoot, options);
  return {
    editCode: (input, context) =>
      invoke("edit_code", input, lightToolContext(context)),
    readCode: (input, context) =>
      invoke("read_code", input, lightToolContext(context)),
    runTask: (input, context) =>
      invoke("run_task", input, lightToolContext(context), context.signal),
    searchCode: (input, signal) => invoke("search_code", input, {}, signal),
  };
}

function executorInvocation(
  workspaceRoot: string,
  options: LightHarnessToolsOptions,
) {
  return (
    tool: LightWorkspaceToolName,
    input: unknown,
    context: LightToolContext = {},
    signal?: AbortSignal,
  ) =>
    options.executor!(
      {
        input,
        taskContract: options.taskContract,
        tool,
        toolContext: context,
        workspaceRoot,
      },
      signal,
    );
}

function lightWorkspaceTools(
  workspace: LightWorkspacePort,
  capabilities: string,
) {
  return [
    searchCodeTool(workspace),
    readCodeTool(workspace, capabilities),
    editCodeTool(workspace, capabilities),
    runTaskTool(workspace),
  ];
}

function searchCodeTool(workspace: LightWorkspacePort) {
  return harnessTool({
    name: "search_code",
    description:
      "Find workspace source by path, text, symbol, or references. Auto promotes lexical hits inside supported symbols to editable sN aliases; multi-term queries match useful terms instead of requiring an exact phrase. Scope accepts paths and *, **, ?, or {a,b} globs. Generated outputs and node_modules are unavailable by design. Returns at most eight short results.",
    schema: lightSearchCodeInputSchema,
    execute: (input, context) => workspace.searchCode(input, context.signal),
  });
}

function readCodeTool(workspace: LightWorkspacePort, capabilities: string) {
  return harnessTool({
    name: "read_code",
    description: `Read a file, a compact bounded directory listing, an sN alias, path#qualifiedName, @changes, or @capabilities. Omit view normally: auto reads small files raw and routes large supported files to compact outlines. Raw and already_in_context results include concrete editTargets when structural symbols overlap the read. Requesting symbol for a lexical alias promotes its enclosing symbol. Explicit raw is intended only for small or non-structural files; generated outputs and node_modules are unavailable. Unsupported symbolic views fall back to raw in this call.\n${capabilities}`,
    schema: lightReadCodeInputSchema,
    execute: (input, context) => workspace.readCode(input, context),
  });
}

function editCodeTool(workspace: LightWorkspacePort, capabilities: string) {
  return harnessTool({
    name: "edit_code",
    description: `Apply one atomic batch of symbolic replacements and native Cline Apply Patch operations. Prefer symbol operations inside existing supported symbols; use focused patches for imports, raw/config files, new files, or small cross-symbol changes. Append code or CSS with insert_after on a returned editTarget instead of patching a generic delimiter. Independent operations in one call remain atomic. Multi-file Cline patches are accepted and attributed automatically. Operations share one snapshot, reject overlaps, parse only final states, and never require hashes or revisions.\n${capabilities}`,
    schema: lightEditCodeInputSchema,
    execute: (input, context) =>
      workspace.editCode(input, {
        sessionId: context.sessionId,
        toolCallId: context.toolCallId,
      }),
  });
}

function runTaskTool(workspace: LightWorkspacePort) {
  return harnessTool({
    name: "run_task",
    description:
      "Run a known finite project validation or read-only bounded command, add/remove dependencies through the detected package manager, or apply Prettier atomically to explicit existing file paths with `pnpm exec prettier --write <files>`. Identical validations at the same source revision are reused. Other filesystem writes, directory-wide formatters, dev servers, databases, containers, background processes, and manual preview infrastructure are denied. Returns compact successful output or a complete bounded failure diagnostic with code/environment classification.",
    schema: lightRunTaskInputSchema,
    execute: (input, context) => workspace.runTask(input, context),
  });
}

type ToolDefinition<TSchema extends z.ZodTypeAny> = {
  description: string;
  execute(
    input: z.infer<TSchema>,
    context: AgentToolContext,
  ): Promise<LightToolResult<unknown>>;
  name: string;
  schema: TSchema;
};

function harnessTool<TSchema extends z.ZodTypeAny>(
  definition: ToolDefinition<TSchema>,
): AgentTool {
  return createTool({
    name: definition.name,
    description: definition.description,
    inputSchema: definition.schema as unknown as Record<string, unknown>,
    retryable: false,
    maxRetries: 0,
    async execute(value: unknown, context: AgentToolContext) {
      const parsed = definition.schema.safeParse(value);
      if (!parsed.success) return invalidInput(parsed.error);
      return redactSecurityValue(
        await definition.execute(parsed.data, context),
      );
    },
  });
}

function invalidInput(error: z.ZodError): LightToolResult<unknown> {
  return {
    status: "blocked",
    category: "input",
    message: error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; "),
  };
}
