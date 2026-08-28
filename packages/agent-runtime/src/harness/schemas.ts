import { z } from "zod";
import { semanticLanguageIds } from "./language-capabilities.js";

export const symbolKindSchema = z.enum([
  "class",
  "constructor",
  "enum",
  "function",
  "interface",
  "method",
  "module",
  "namespace",
  "property",
  "struct",
  "trait",
  "type",
  "variable",
  "css_rule",
  "css_media",
  "css_keyframes",
  "css_custom_property",
]);

export const relationKindSchema = z.enum([
  "calls",
  "implements",
  "imports",
  "reads",
  "references",
  "tested_by",
  "writes",
]);

export const sourceRevisionIdSchema = z
  .string()
  .regex(/^src_[a-f0-9]{32}$/)
  .describe(
    "Exact source_revision_id returned by workspace_state or a committed proposal.",
  );

const symbolReferenceSchema = z
  .string()
  .regex(/^(?:sym:\/\/|s_[a-z0-9]{2,10}$)/u);
const nodeReferenceSchema = z
  .string()
  .regex(/^(?:node:\/\/|n_[a-z0-9]{2,10}$)/u);
const matchReferenceSchema = z
  .string()
  .regex(/^(?:match:\/\/|m_[a-z0-9]{2,10}$)/u);

export const digestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .describe("SHA-256 digest returned by the harness.");

export const relativePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .describe(
    "Workspace-relative path. Absolute paths and workspace escapes are rejected.",
  );

export const artifactRefSchema = z
  .object({
    ref: z.string().regex(/^artifact:\/\/[a-f0-9]{64}$/),
    content_hash: digestSchema,
    media_type: z.string().min(1).max(200),
    schema_version: z.string().min(1).max(50),
    visibility: z.enum(["agent_redacted", "reviewer", "sealed_raw"]),
  })
  .strict();

export const sourceRevisionRefSchema = z
  .object({
    source_revision_id: sourceRevisionIdSchema,
    base_commit: z.string().min(1).optional(),
    overlay_merkle_root: digestSchema,
  })
  .strict();

const outputBudget = (minimum: number, maximum: number, fallback: number) =>
  z
    .object({
      max_output_tokens: z
        .number()
        .int()
        .min(minimum)
        .max(maximum)
        .default(fallback)
        .describe(
          `Bounded value from ${minimum} to ${maximum}; default ${fallback}.`,
        ),
    })
    .strict()
    .optional();

const byteRangeSchema = z
  .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
  .refine(([start, end]) => end >= start, {
    message: "The byte range end must be greater than or equal to its start.",
  })
  .describe("Half-open [start,end] UTF-8 byte range.");

export const workspaceStateInputSchema = z
  .object({
    include: z
      .array(
        z.enum([
          "source_revision",
          "environment_spec",
          "task_contract",
          "repository",
          "capabilities",
          "tree_summary",
          "changes",
          "task_catalog",
          "task_projection",
        ]),
      )
      .optional(),
    cursor: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe(
        "Short revision-bound next_cursor returned by a previous workspace_state page.",
      ),
    page_size: z
      .number()
      .int()
      .min(1)
      .max(25)
      .optional()
      .describe(
        "Number of complete manifests or tasks returned for a cursor; default 5.",
      ),
    budget: outputBudget(500, 20_000, 8_000),
  })
  .strict();

const searchQuerySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("text"),
      pattern: z.string().min(1).max(1_000),
      regex: z.boolean().optional(),
      case_sensitive: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("symbol"),
      name: z.string().min(1).max(300),
      kinds: z.array(symbolKindSchema).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ast_pattern"),
      language: z.enum(semanticLanguageIds).optional(),
      pattern: z.string().min(1).max(2_000),
    })
    .strict(),
]);

export const searchCodeInputSchema = z
  .object({
    source_revision_id: sourceRevisionIdSchema.optional(),
    query: searchQuerySchema,
    scope: z
      .object({
        paths: z.array(relativePathSchema).max(100).optional(),
        languages: z.array(z.string().min(1).max(100)).optional(),
        include_generated: z.boolean().optional(),
      })
      .strict()
      .optional(),
    max_results: z.number().int().min(1).max(100).default(30).optional(),
    budget: outputBudget(200, 8_000, 2_000),
  })
  .strict();

export const outlineCodeInputSchema = z
  .object({
    source_revision_id: sourceRevisionIdSchema.optional(),
    target: z.object({ path: relativePathSchema }).strict(),
    kinds: z.array(symbolKindSchema).optional(),
    depth: z.number().int().min(1).max(12).default(3).optional(),
    include: z.array(z.enum(["signature", "visibility"])).optional(),
    budget: z
      .object({
        max_output_tokens: z.number().int().min(200).max(12_000).default(3_000),
        max_items: z.number().int().min(1).max(500).default(80),
      })
      .strict()
      .optional(),
  })
  .strict();

const inspectTargetSchema = z.union([
  z.object({ symbol_ref: z.string().min(1) }).strict(),
  z.object({ node_ref: z.string().min(1) }).strict(),
  z.object({ match_ref: z.string().min(1) }).strict(),
  z.object({ path: relativePathSchema }).strict(),
]);

export const inspectCodeInputSchema = z
  .object({
    source_revision_id: sourceRevisionIdSchema.optional(),
    target: inspectTargetSchema,
    view: z.enum([
      "body",
      "declaration",
      "interface",
      "neighborhood",
      "raw",
      "signature",
    ]),
    range_utf8_bytes: byteRangeSchema.optional(),
    budget: outputBudget(100, 20_000, 2_500),
  })
  .strict()
  .superRefine((value, context) => {
    if ("path" in value.target && value.view !== "raw")
      context.addIssue({
        code: "custom",
        path: ["view"],
        message: "A path target is valid only with the raw view.",
      });
    if (value.range_utf8_bytes && value.view !== "raw")
      context.addIssue({
        code: "custom",
        path: ["range_utf8_bytes"],
        message: "A byte range is valid only with the raw view.",
      });
  });

export const getRelationContextInputSchema = z
  .object({
    source_revision_id: sourceRevisionIdSchema.optional(),
    target: z.object({ symbol_ref: symbolReferenceSchema }).strict(),
    relations: z
      .array(relationKindSchema)
      .min(1)
      .max(7)
      .default(["calls", "imports", "references", "tested_by"])
      .optional(),
    scope: z
      .object({ paths: z.array(relativePathSchema).max(100).optional() })
      .strict()
      .optional(),
    include: z
      .array(z.enum(["excerpts", "node_refs"]))
      .max(2)
      .default(["excerpts"])
      .optional(),
    max_results: z.number().int().min(1).max(100).default(30).optional(),
    budget: outputBudget(200, 8_000, 1_800),
  })
  .strict();

const structuredTargetSchema = z
  .string()
  .regex(/^(?:(?:match|node|sym):\/\/[A-Za-z0-9_-]+|[mns]_[a-z0-9]{2,10})$/u)
  .describe("Exact match_ref, node_ref, or symbol_ref returned by a read.");

export const changeOperationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("replace_node"),
      target: structuredTargetSchema,
      replacement: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("insert_before"),
      target: structuredTargetSchema,
      source: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("insert_after"),
      target: structuredTargetSchema,
      source: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("text_replace"),
      path: relativePathSchema,
      expected_blob_hash: digestSchema,
      range_utf8_bytes: byteRangeSchema,
      expected_old_text: z.string(),
      replacement: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("create_file"),
      path: relativePathSchema,
      content: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("delete_file"),
      path: relativePathSchema,
      expected_blob_hash: digestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("move_file"),
      from_path: relativePathSchema,
      to_path: relativePathSchema,
      expected_blob_hash: digestSchema,
    })
    .strict(),
]);

const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(200)
  .describe("Caller-stable key. Reuse with different input is rejected.");

export const proposeChangeInputSchema = z
  .object({
    action: z.literal("propose"),
    base_source_revision_id: sourceRevisionIdSchema,
    idempotency_key: idempotencyKeySchema,
    operations: z.array(changeOperationSchema).min(1).max(50),
    policies: z
      .object({
        format: z.enum(["none", "touched_files"]).default("none").optional(),
        organize_imports: z.literal(false).default(false).optional(),
        max_touched_files: z.number().int().min(1).max(50).default(20),
        preserve_public_api: z.boolean().default(false).optional(),
      })
      .strict()
      .optional(),
    checks: z.array(z.literal("parse")).optional(),
  })
  .strict();

export const commitProposalInputSchema = z
  .object({
    action: z.literal("commit_proposal"),
    proposal_ref: z.string().regex(/^change-proposal:\/\/[a-f0-9]{64}$/),
    expected_base_source_revision_id: sourceRevisionIdSchema,
    idempotency_key: idempotencyKeySchema,
  })
  .strict();

export const directApplyChangeInputSchema = proposeChangeInputSchema.extend({
  action: z.literal("apply"),
});

export const applyChangeInputSchema = z.discriminatedUnion("action", [
  directApplyChangeInputSchema,
  proposeChangeInputSchema,
  commitProposalInputSchema,
]);

const semanticEditTargetSchema = z.union([
  z.object({ symbol_ref: symbolReferenceSchema }).strict(),
  z.object({ node_ref: nodeReferenceSchema }).strict(),
  z.object({ match_ref: matchReferenceSchema }).strict(),
]);

const jsonPathSchema = z
  .array(z.union([z.string().max(1_000), z.number().int().nonnegative()]))
  .max(100);

export const jsonOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("set"),
      path: jsonPathSchema,
      value: z.unknown(),
    })
    .strict(),
  z.object({ type: z.literal("delete"), path: jsonPathSchema }).strict(),
  z
    .object({
      type: z.literal("merge"),
      path: jsonPathSchema,
      value: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal("append"),
      path: jsonPathSchema,
      value: z.unknown(),
    })
    .strict(),
]);

export const editCodeOperationSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.enum(["replace", "replace_symbol"]),
      target: semanticEditTargetSchema,
      path: relativePathSchema.optional(),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      operation: z.enum(["replace_body", "replace_signature"]),
      target: z.object({ symbol_ref: symbolReferenceSchema }).strict(),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      operation: z.enum(["insert_before", "insert_after"]),
      target: semanticEditTargetSchema,
      content: z.string(),
    })
    .strict(),
  z
    .object({
      operation: z.enum(["delete", "delete_symbol"]),
      target: semanticEditTargetSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("set_css_declarations"),
      target: z.object({ symbol_ref: symbolReferenceSchema }).strict(),
      declarations: z.record(z.string().min(1), z.string().nullable()),
    })
    .strict(),
  z
    .object({
      operation: z.literal("set_css_declaration"),
      target: z.object({ symbol_ref: symbolReferenceSchema }).strict(),
      property: z.string().min(1).max(500),
      value: z.string().max(100_000),
    })
    .strict(),
  z
    .object({
      operation: z.literal("remove_css_declaration"),
      target: z.object({ symbol_ref: symbolReferenceSchema }).strict(),
      property: z.string().min(1).max(500),
    })
    .strict(),
  z
    .object({
      operation: z.literal("insert_css_declaration"),
      target: z.object({ symbol_ref: symbolReferenceSchema }).strict(),
      property: z.string().min(1).max(500),
      value: z.string().max(100_000),
      after_property: z.string().min(1).max(500).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("create_file"),
      path: relativePathSchema,
      content: z.string(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("move_file"),
      from_path: relativePathSchema,
      to_path: relativePathSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("replace_file"),
      path: relativePathSchema,
      content: z.string(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("delete_file"),
      path: relativePathSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("edit_json"),
      path: relativePathSchema,
      operations: z.array(jsonOperationSchema).min(1).max(100),
    })
    .strict(),
  z
    .object({
      operation: z.enum(["patch", "patch_file"]),
      path: relativePathSchema,
      patch: z
        .string()
        .min(1)
        .max(2 * 1024 * 1024),
    })
    .strict(),
]);

export const editCodeInputSchema = z
  .object({
    edits: z.array(editCodeOperationSchema).min(1).max(50),
    formatting: z.enum(["none", "touched_files"]).default("none").optional(),
    validation: z
      .object({ parse: z.boolean().default(true).optional() })
      .strict()
      .optional(),
  })
  .strict();

export const editSymbolInputSchema = z
  .object({
    path: relativePathSchema,
    symbolRef: symbolReferenceSchema,
    replacement: z.string(),
  })
  .strict();

export const editJsonInputSchema = z
  .object({
    path: relativePathSchema,
    operations: z.array(jsonOperationSchema).min(1).max(100),
  })
  .strict();

export const patchFileInputSchema = z
  .object({
    path: relativePathSchema,
    patch: z
      .string()
      .min(1)
      .max(2 * 1024 * 1024),
  })
  .strict();

export const editFilesInputSchema = z
  .object({
    operations: z.array(editCodeOperationSchema).min(1).max(50),
  })
  .strict();

export const createFileInputSchema = z
  .object({ path: relativePathSchema, content: z.string() })
  .strict();

export const replaceFileInputSchema = createFileInputSchema;

export const deleteFileInputSchema = z
  .object({ path: relativePathSchema })
  .strict();

export const moveFileInputSchema = z
  .object({ fromPath: relativePathSchema, toPath: relativePathSchema })
  .strict();

export const recallContextInputSchema = z
  .object({
    query: z.string().min(1).max(1_000).optional(),
    topic: z.string().min(1).max(1_000).optional(),
    file_path: relativePathSchema.optional(),
    symbol_ref: z
      .string()
      .regex(/^(?:(?:node|sym):\/\/[A-Za-z0-9_-]+|[ns]_[a-z0-9]{2,10})$/u)
      .optional(),
    change_receipt_id: z.string().min(1).max(500).optional(),
    include_superseded: z.boolean().optional(),
    maximum_tokens: z.number().int().min(100).max(8_000).optional(),
  })
  .strict();

export const reviewChangeInputSchema = z
  .object({
    proposal_ref: z.string().regex(/^change-proposal:\/\/[a-f0-9]{64}$/),
    include: z
      .array(z.enum(["impact", "semantic_diff"]))
      .max(2)
      .default(["semantic_diff"])
      .optional(),
    budget: outputBudget(200, 20_000, 4_000),
  })
  .strict();

export const validateChangeInputSchema = z
  .object({
    proposal_ref: z.string().regex(/^change-proposal:\/\/[a-f0-9]{64}$/),
    criteria: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            text: z.string().min(1).max(1_000),
            requires: z
              .array(z.enum(["build", "lint", "parse", "test", "typecheck"]))
              .min(1)
              .max(5),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    budget: outputBudget(200, 8_000, 2_500),
  })
  .strict();

export const taskKindSchema = z.enum([
  "build",
  "custom",
  "dependencies",
  "lint",
  "service",
  "test",
  "typecheck",
]);

export const taskCatalogItemSchema = z
  .object({
    task_id: z.string().min(1).max(300),
    script: z.string().min(1).max(300).optional(),
    kind: taskKindSchema,
    command: z.string().min(1).max(2_000),
    cwd: relativePathSchema,
    package_manager: z.enum(["bun", "npm", "pnpm", "yarn"]),
    package_manager_version: z.string().min(1).max(100).optional(),
    supportsFileSelection: z.boolean().default(false),
    requiresNetwork: z.boolean().default(false),
    dependencyPolicy: z.enum(["required", "optional"]).default("required"),
  })
  .strict();

const dependencyTypeSchema = z.enum([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]);

export const dependencyMutationInputSchema = z
  .object({
    source_revision_id: sourceRevisionIdSchema,
    package_path: relativePathSchema.default("package.json"),
    operations: z
      .array(
        z.discriminatedUnion("action", [
          z
            .object({
              action: z.literal("add"),
              name: z.string().regex(/^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/iu),
              version: z.string().min(1).max(200),
              dependency_type: dependencyTypeSchema.default("dependencies"),
            })
            .strict(),
          z
            .object({
              action: z.literal("remove"),
              name: z.string().regex(/^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/iu),
              dependency_type: dependencyTypeSchema.optional(),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(50),
    timeout_ms: z.number().int().min(1_000).max(900_000).default(120_000),
    idempotency_key: idempotencyKeySchema.optional(),
  })
  .strict();

const taskSelectionSchema = z
  .object({
    tests: z.array(z.string().min(1).max(1_000)).max(100).optional(),
    files: z.array(relativePathSchema).max(100).optional(),
    symbols: z.array(symbolReferenceSchema).max(100).optional(),
  })
  .strict()
  .optional();

export const runTaskInputSchema = z
  .object({
    source_revision_id: sourceRevisionIdSchema,
    task: z.union([
      z.object({ task_id: z.string().min(1).max(300) }).strict(),
      z
        .object({
          kind: z.enum(["test", "lint", "build", "typecheck", "dependencies"]),
          target: z.string().min(1).max(300).optional(),
        })
        .strict(),
    ]),
    selection: taskSelectionSchema,
    environment_profile: z.literal("default").default("default").optional(),
    limits: z
      .object({
        timeout_ms: z.number().int().min(1_000).max(900_000),
        cpu: z.number().min(0.1).max(64).optional(),
        memory_mb: z.number().int().min(64).max(32_768).optional(),
        output_bytes: z
          .number()
          .int()
          .min(1_024)
          .max(10 * 1024 * 1024)
          .default(512 * 1024)
          .optional(),
      })
      .strict(),
    idempotency_key: idempotencyKeySchema.optional(),
  })
  .strict();

export const inspectRunInputSchema = z
  .object({
    run_ref: z.string().regex(/^run:\/\/[a-f0-9]{64}$/),
    view: z.enum([
      "diagnostics",
      "events",
      "failures",
      "filesystem_effects",
      "performance",
      "stderr_tail",
      "stdout_head",
      "stdout_tail",
      "summary",
    ]),
    budget: outputBudget(100, 20_000, 2_500),
  })
  .strict();

export const inspectArtifactInputSchema = z
  .object({
    artifact_ref: z.string().regex(/^artifact:\/\/[a-f0-9]{64}$/),
    view: z.enum(["bytes", "json", "metadata", "text"]),
    offset_bytes: z.number().int().nonnegative().default(0).optional(),
    budget: outputBudget(100, 20_000, 2_500),
  })
  .strict();

const runFailureSchema = z
  .object({
    message: z.string().min(1).max(2_000),
    location: z.string().min(1).max(1_000).optional(),
  })
  .strict();

const runDiagnosticSchema = z
  .object({
    code: z.string().min(1).max(200).optional(),
    severity: z.enum(["error", "warning", "info"]),
    message: z.string().min(1).max(2_000),
    path: relativePathSchema.optional(),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    dependency: z.string().min(1).max(500).optional(),
    installation_supported: z.boolean().optional(),
    recommendation: z.string().min(1).max(2_000).optional(),
  })
  .strict();

const filesystemEffectsSchema = z
  .object({
    created: z.array(relativePathSchema).max(500),
    modified: z.array(relativePathSchema).max(500),
    deleted: z.array(relativePathSchema).max(500),
    truncated: z.boolean(),
    disposition: z.enum(["captured", "discarded", "none"]),
    artifact: artifactRefSchema,
    change_proposal_ref: z
      .string()
      .regex(/^change-proposal:\/\/[a-f0-9]{64}$/)
      .optional(),
    reason: z.string().min(1).max(1_000).optional(),
  })
  .strict();

export const storedRunSchema = z
  .object({
    schema_version: z.literal("1.0"),
    run_ref: z.string().regex(/^run:\/\/[a-f0-9]{64}$/),
    content_hash: digestSchema,
    source_revision: sourceRevisionRefSchema,
    environment_spec_revision_id: z.string().regex(/^env_[a-f0-9]{32}$/),
    runtime_instance_id: z.string().regex(/^runtime_[a-f0-9]{32}$/),
    task: taskCatalogItemSchema,
    selection: taskSelectionSchema,
    execution: z
      .object({
        argv: z.array(z.string().max(4_096)).min(1).max(200),
        cwd: relativePathSchema,
        environment_profile: z.literal("default"),
        environment_variables: z.array(z.string().max(200)).max(50),
        package_manager_resolution: z
          .object({
            name: z.enum(["bun", "npm", "pnpm", "yarn"]),
            requested_version: z.string().min(1).max(100).optional(),
            resolved_version: z.string().min(1).max(100),
            strategy: z.enum(["compatible_same_major", "exact", "unversioned"]),
          })
          .strict()
          .optional(),
        process_tree: z.enum(["host_descendants", "sandbox_descendants"]),
        ignored_limits: z
          .array(z.enum(["cpu", "memory_mb"]))
          .max(2)
          .optional(),
        observed_ports: z.array(z.number().int().min(1).max(65_535)).max(100),
        volatility: z
          .array(z.enum(["timestamps", "runtime_instance_id", "ports"]))
          .max(3),
      })
      .strict(),
    status: z.enum([
      "cancelled",
      "execution_error",
      "failed",
      "passed",
      "timed_out",
    ]),
    exit_code: z.number().int().nullable(),
    signal: z.string().nullable(),
    started_at: z.string().datetime(),
    completed_at: z.string().datetime(),
    duration_ms: z.number().int().nonnegative(),
    limits: runTaskInputSchema.shape.limits,
    network: z
      .object({
        requested: z.enum(["deny", "project_allowlist"]),
        enforcement: z.enum([
          "bubblewrap",
          "project_proxy",
          "sandbox_exec",
          "worktree",
        ]),
        effective: z.enum(["deny", "host"]).optional(),
      })
      .strict(),
    logs: z
      .object({
        complete: artifactRefSchema,
        sealed_raw: artifactRefSchema,
        stdout_head: z.string().max(16_000),
        stdout_tail: z.string().max(16_000),
        stderr_tail: z.string().max(16_000),
        output_truncated: z.boolean(),
      })
      .strict(),
    failures: z.array(runFailureSchema).max(100),
    diagnostics: z.array(runDiagnosticSchema).max(500),
    filesystem_effects: filesystemEffectsSchema,
    idempotency_key: idempotencyKeySchema.optional(),
    input_digest: digestSchema,
  })
  .strict();

export const proposedFileSchema = z
  .object({
    path: relativePathSchema,
    old_artifact: artifactRefSchema.nullable(),
    new_artifact: artifactRefSchema.nullable(),
    old_hash: digestSchema.nullable(),
    new_hash: digestSchema.nullable(),
    old_mode: z.number().int().min(0).max(0o777).nullable(),
    new_mode: z.number().int().min(0).max(0o777).nullable(),
    binary: z.boolean(),
  })
  .strict();

export const parseDiagnosticSchema = z
  .object({
    path: relativePathSchema,
    before_errors: z.number().int().nonnegative(),
    after_errors: z.number().int().nonnegative(),
    analysis: z.enum(["parser", "unsupported"]),
  })
  .strict();

export const storedChangeProposalSchema = z
  .object({
    schema_version: z.literal("1.1"),
    proposal_ref: z.string().regex(/^change-proposal:\/\/[a-f0-9]{64}$/),
    content_hash: digestSchema,
    base_source_revision_id: sourceRevisionIdSchema,
    idempotency_key: idempotencyKeySchema,
    input_digest: digestSchema,
    created_at: z.string().datetime(),
    changes: z.array(proposedFileSchema).min(1).max(50),
    diff_artifact: artifactRefSchema,
    diff_summary: z.string(),
    diff_summary_truncated: z.boolean().optional(),
    diff_summary_bytes: z.number().int().nonnegative().optional(),
    diff_bytes: z.number().int().nonnegative().optional(),
    diagnostics: z.array(parseDiagnosticSchema),
    formatting: z
      .object({
        policy: z.enum(["none", "touched_files"]),
        formatter: z.literal("prettier").optional(),
        formatter_version: z.string().min(1).max(50).optional(),
        formatted_files: z.array(relativePathSchema).max(50),
        skipped_files: z.array(relativePathSchema).max(50),
      })
      .strict()
      .optional(),
  })
  .strict();

export const commitReceiptSchema = z
  .object({
    schema_version: z.literal("1.1"),
    change_set_ref: z.string().regex(/^changeset:\/\/[a-f0-9]{64}$/),
    proposal_ref: z.string().regex(/^change-proposal:\/\/[a-f0-9]{64}$/),
    idempotency_key: idempotencyKeySchema,
    source_revision: sourceRevisionRefSchema,
    changed_files: z.array(relativePathSchema).max(50),
  })
  .strict();

export const proposalIdempotencyRecordSchema = z
  .object({
    schema_version: z.literal("1.0"),
    input_digest: digestSchema,
    proposal_ref: z.string().regex(/^change-proposal:\/\/[a-f0-9]{64}$/),
  })
  .strict();

export const commitJournalSchema = z
  .object({
    schema_version: z.literal("1.0"),
    proposal_ref: z.string().regex(/^change-proposal:\/\/[a-f0-9]{64}$/),
    expected_base_source_revision_id: sourceRevisionIdSchema,
    idempotency_key: idempotencyKeySchema,
    changed_files: z.array(relativePathSchema).min(1).max(50),
    created_at: z.string().datetime(),
  })
  .strict();

export type WorkspaceStateInput = z.infer<typeof workspaceStateInputSchema>;
export type SearchCodeInput = z.infer<typeof searchCodeInputSchema>;
export type OutlineCodeInput = z.infer<typeof outlineCodeInputSchema>;
export type InspectCodeInput = z.infer<typeof inspectCodeInputSchema>;
export type GetRelationContextInput = z.infer<
  typeof getRelationContextInputSchema
>;
export type RelationKind = z.infer<typeof relationKindSchema>;
export type ChangeOperation = z.infer<typeof changeOperationSchema>;
export type ProposeChangeInput = z.infer<typeof proposeChangeInputSchema>;
export type DirectApplyChangeInput = z.infer<
  typeof directApplyChangeInputSchema
>;
export type CommitProposalInput = z.infer<typeof commitProposalInputSchema>;
export type ApplyChangeInput = z.infer<typeof applyChangeInputSchema>;
export type EditCodeOperation = z.infer<typeof editCodeOperationSchema>;
export type EditCodeInput = z.infer<typeof editCodeInputSchema>;
export type EditSymbolInput = z.infer<typeof editSymbolInputSchema>;
export type EditJsonInput = z.infer<typeof editJsonInputSchema>;
export type PatchFileInput = z.infer<typeof patchFileInputSchema>;
export type EditFilesInput = z.infer<typeof editFilesInputSchema>;
export type CreateFileInput = z.infer<typeof createFileInputSchema>;
export type ReplaceFileInput = z.infer<typeof replaceFileInputSchema>;
export type DeleteFileInput = z.infer<typeof deleteFileInputSchema>;
export type MoveFileInput = z.infer<typeof moveFileInputSchema>;
export type ReviewChangeInput = z.infer<typeof reviewChangeInputSchema>;
export type ValidateChangeInput = z.infer<typeof validateChangeInputSchema>;
export type RunTaskInput = z.infer<typeof runTaskInputSchema>;
export type DependencyMutationInput = z.infer<
  typeof dependencyMutationInputSchema
>;
export type InspectRunInput = z.infer<typeof inspectRunInputSchema>;
export type InspectArtifactInput = z.infer<typeof inspectArtifactInputSchema>;
export type RecallContextInput = z.infer<typeof recallContextInputSchema>;
export type TaskCatalogItem = z.infer<typeof taskCatalogItemSchema>;
export type StoredRun = z.infer<typeof storedRunSchema>;
export type ProposedFile = z.infer<typeof proposedFileSchema>;
export type ParseDiagnostic = z.infer<typeof parseDiagnosticSchema>;
export type StoredChangeProposal = z.infer<typeof storedChangeProposalSchema>;
export type CommitReceipt = z.infer<typeof commitReceiptSchema>;
export type ProposalIdempotencyRecord = z.infer<
  typeof proposalIdempotencyRecordSchema
>;
export type CommitJournal = z.infer<typeof commitJournalSchema>;

export function parseStoredChangeProposal(value: unknown) {
  return storedChangeProposalSchema.parse(value);
}

export function parseCommitReceipt(value: unknown) {
  return commitReceiptSchema.parse(value);
}

export function parseStoredRun(value: unknown) {
  return storedRunSchema.parse(value);
}

export function formatSchemaError(error: z.ZodError) {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");
}
