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
      "Find code by text, symbol, or references. Auto routes likely identifiers to the loaded syntax adapters and free text to ripgrep. Returns at most eight short results with sN aliases; reference mode reports when it used lexical fallback.",
    schema: lightSearchCodeInputSchema,
    execute: (input, context) => workspace.searchCode(input, context.signal),
  });
}

function readCodeTool(workspace: LightWorkspacePort, capabilities: string) {
  return harnessTool({
    name: "read_code",
    description: `Read a path, sN alias, path#qualifiedName, @changes, or @capabilities. Auto reads small files raw and uses outlines or symbols only when they save context. Unsupported symbolic views fall back to raw in this call.\n${capabilities}`,
    schema: lightReadCodeInputSchema,
    execute: (input, context) => workspace.readCode(input, context),
  });
}

function editCodeTool(workspace: LightWorkspacePort, capabilities: string) {
  return harnessTool({
    name: "edit_code",
    description: `Apply one atomic batch of symbolic replacements and Cline Apply Patch operations. Operations share one starting snapshot, may mix files and formats, reject overlaps, parse only final states, and never require hashes or revisions.\n${capabilities}`,
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
      "Run a known project script or bounded command in the current worktree, or add/remove dependencies through the detected package manager. Returns the command, exit code, first useful diagnostic, and realistic recovery without generic retries.",
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
