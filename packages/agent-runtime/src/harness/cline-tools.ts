import { createTool, type AgentTool, type AgentToolContext } from "@cline/sdk";
import { z } from "zod";
import { harnessError } from "./protocol.js";
import {
  applyChangeInputSchema,
  formatSchemaError,
  inspectCodeInputSchema,
  outlineCodeInputSchema,
  reviewChangeInputSchema,
  searchCodeInputSchema,
  workspaceStateInputSchema,
} from "./schemas.js";
import { SemanticWorkspace } from "./semantic-workspace.js";

export const semanticWorkspaceReadToolNames = [
  "workspace_state",
  "search_code",
  "outline_code",
  "inspect_code",
  "review_change",
];

export const semanticWorkspaceWriteToolNames = ["apply_change"];

export function semanticWorkspaceTools(workspaceRoot?: string): AgentTool[] {
  if (!workspaceRoot) return [];
  const workspace = new SemanticWorkspace(workspaceRoot);
  return [
    createHarnessTool({
      name: "workspace_state",
      description:
        "Read the canonical Blame workspace state and obtain the current source_revision_id. Use this before semantic reads or edits, and again after STALE_REVISION. Returns Git/base state, changed paths, a compact tree/language summary, task catalog, and supported harness capabilities. Read-only; do not use it to inspect file contents.",
      schema: workspaceStateInputSchema,
      execute: (input, context) =>
        workspace.workspaceState({ ...input, signal: context.signal }),
    }),
    createHarnessTool({
      name: "search_code",
      description:
        "Search one exact source revision using ripgrep text search, syntax symbols, or an ast-grep pattern. Use for localization and to obtain exact node_ref/symbol_ref handles before inspect_code or apply_change. Returns the engine, bounded matches, byte/line ranges, provenance, and explicit truncation. Do not use stale handles or use this as natural-language semantic search.",
      schema: searchCodeInputSchema,
      execute: (input, context) => workspace.searchCode(input, context.signal),
    }),
    createHarnessTool({
      name: "outline_code",
      description:
        "Return a progressive syntax outline for a file or directory at an exact source revision. Use before broad file reads to discover classes, functions, methods, interfaces, types, enums, and function-valued variables. Each item returns an exact revision-bound symbol_ref and node_ref. Unsupported files return parse-quality diagnostics; use inspect_code view raw as the fallback.",
      schema: outlineCodeInputSchema,
      execute: (input, context) => workspace.outlineCode(input, context.signal),
    }),
    createHarnessTool({
      name: "inspect_code",
      description:
        "Inspect one exact revision-bound symbol/node, or read a raw file fallback. Use symbol_ref/node_ref from search_code or outline_code for signature, declaration, body, interface, or neighborhood views. Use target.path only with view raw. Returns byte ranges, file hash/ref, omissions, provenance, and STALE_REVISION instead of silently rematching.",
      schema: inspectCodeInputSchema,
      execute: (input, context) => workspace.inspectCode(input, context.signal),
    }),
    createHarnessTool({
      name: "apply_change",
      description:
        "Create or commit a transactional code change with compare-and-swap. First call action propose with the exact base source revision, immutable node/text/file operations, and an idempotency key. Review the immutable result, then call commit_proposal with the same base and a commit idempotency key. Never silently relocates stale targets; writes are locked across processes and crash-recoverable.",
      schema: applyChangeInputSchema,
      execute: (input, context) => workspace.applyChange(input, context.signal),
      retryable: false,
    }),
    createHarnessTool({
      name: "review_change",
      description:
        "Review an immutable change proposal without mutating source or running checks. Use after apply_change propose and before commit_proposal. Returns textual diff, file hashes, syntax-symbol additions/removals, parse diagnostics, staleness, attached artifact, and checks not yet run.",
      schema: reviewChangeInputSchema,
      execute: (input, context) =>
        workspace.reviewChange(input, context.signal),
    }),
  ];
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
