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
  return lightWorkspaceTools(workspace);
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

function lightWorkspaceTools(workspace: LightWorkspacePort) {
  return [
    searchCodeTool(workspace),
    readCodeTool(workspace),
    editCodeTool(workspace),
    runTaskTool(workspace),
  ];
}

function searchCodeTool(workspace: LightWorkspacePort) {
  return harnessTool({
    name: "search_code",
    description:
      "Find source by path, text, symbol, or references. Lexical hits inside supported symbols become editable sN aliases. Multi-term queries match useful terms. Scope accepts paths and *, **, ?, or {a,b} globs. Returns up to eight short results; generated outputs and node_modules are excluded.",
    schema: lightSearchCodeInputSchema,
    execute: (input, context) => workspace.searchCode(input, context.signal),
  });
}

function readCodeTool(workspace: LightWorkspacePort) {
  return harnessTool({
    name: "read_code",
    description:
      "Read one target or up to eight independent targets in one call: file, compact directory, sN alias, path#qualifiedName, @changes, or @capabilities. Omit view for automatic raw/outline routing. Results expose editTargets and containedBy relationships; unsupported symbolic views fall back to raw. Generated outputs and node_modules are excluded.",
    schema: lightReadCodeInputSchema,
    execute: (input, context) => workspace.readCode(input, context),
  });
}

function editCodeTool(workspace: LightWorkspacePort) {
  return harnessTool({
    name: "edit_code",
    description:
      "Atomically apply symbol operations and native Cline patches. Use symbols inside existing supported targets; use focused patches for imports, raw/config files, new files, or cross-symbol changes. Append with insert_after on an editTarget. Do not combine a parent with its containedBy child. One snapshot validates overlaps and final syntax; hashes and revisions are inferred.",
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
      "Run a known finite validation or bounded read-only command, add/remove dependencies through the detected package manager, or apply Prettier atomically to explicit files with `pnpm exec prettier --write <files>`. Same-revision validations are reused. Other writes and unmanaged services are denied. Returns compact output or a bounded code/environment diagnostic.",
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
