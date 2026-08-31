import { ArtifactStore } from "./artifact-store.js";
import { EditService, type EditCodeOutcome } from "./edit-service.js";
import type { ValidationStatus } from "./content-validation.js";
import {
  materializeSymbol,
  outlineSymbol,
  parseCode,
  structuralMatches,
  type OutlineSymbol,
} from "./code-intelligence.js";
import {
  ChangeService,
  type ApplyChangeInput,
  type CommitProposalInput,
  type CommitReceipt,
  type DirectApplyChangeInput,
  type ProposeChangeInput,
} from "./change-service.js";
import {
  harnessError,
  harnessSuccess,
  provenance,
  sha256,
  type HarnessToolResult,
  type SourceRevisionRef,
} from "./protocol.js";
import {
  approximateTokens,
  bounded,
  countBy,
  lexicalMatch,
  nodeRef,
  publicProposal,
  revisionVector,
  scopedFiles,
  staleRevision,
  symbolNameMatches,
  textMatches,
  toolError,
  topLevelEntries,
  validateOutlineInput,
  validateSearchInput,
  type InspectCodeInput,
  type OutlineCodeInput,
  type PublicChangeProposal,
  type ReviewChangeInput,
  type SearchCodeInput,
  type SearchMatch,
} from "./semantic-workspace-support.js";
import { publicRun, RunService } from "./run-service.js";
import {
  InspectCodeService,
  type InspectCodeData,
} from "./inspect-code-service.js";
import { RelationService } from "./relation-service.js";
import {
  ReferenceRegistry,
  UnavailableReferences,
} from "./reference-registry.js";
import { ChangeReviewService } from "./change-review-service.js";
import { readTaskCatalog } from "./task-catalog.js";
import type { TaskExecutor } from "./task-executor.js";
import {
  languageName,
  WorkspaceFiles,
  type WorkspaceSnapshot,
} from "./workspace-files.js";
import { WorkspaceStateAuthority } from "./workspace-revisions.js";
import { searchWithRipgrep } from "./lexical-search.js";
import {
  capabilityRegistrySnapshot,
  supportedCapabilityOperations,
} from "./language-capabilities.js";
import { harnessFeatureDefinitions } from "./harness-feature-flags.js";
import {
  maximumSemanticParseBytes,
  outlineMaximumItems,
  outlineMaximumOutputTokens,
} from "./code-navigation-policy.js";
import {
  applyChangeInputSchema,
  createFileInputSchema,
  deleteFileInputSchema,
  editCodeInputSchema,
  editFilesInputSchema,
  editJsonInputSchema,
  editSymbolInputSchema,
  inspectArtifactInputSchema,
  inspectRunInputSchema,
  moveFileInputSchema,
  outlineCodeInputSchema,
  patchFileInputSchema,
  recallContextInputSchema,
  replaceFileInputSchema,
  runTaskInputSchema,
  searchCodeInputSchema,
  workspaceStateInputSchema,
  type WorkspaceStateInput,
  type InspectArtifactInput,
  type GetRelationContextInput,
  type InspectRunInput,
  type RecallContextInput,
  type RunTaskInput,
  type ValidateChangeInput,
  type EditCodeInput,
  type CreateFileInput,
  type DeleteFileInput,
  type DependencyMutationInput,
  type EditFilesInput,
  type EditJsonInput,
  type EditSymbolInput,
  type MoveFileInput,
  type PatchFileInput,
  type ReplaceFileInput,
  type TaskCatalogItem,
} from "./schemas.js";
import { ValidationService } from "./validation-service.js";
import { ConversationMemoryStore } from "./conversation-memory.js";
import { DependencyMutationService } from "./dependency-mutation-service.js";
import { workspaceTaskProjection } from "./workspace-task-projection.js";

export type {
  InspectCodeInput,
  OutlineCodeInput,
  PublicChangeProposal,
  ReviewChangeInput,
  SearchCodeInput,
} from "./semantic-workspace-support.js";

export type SemanticWorkspaceOptions = {
  redactSensitiveContent?: boolean;
  taskExecutor?: TaskExecutor;
  taskContract?: {
    acceptance_criteria?: string[];
    effect_requirement?: "none" | "source_change";
    session_id?: string;
    story_id?: string;
    objective?: string;
  };
};

type WorkspaceStateData = {
  capabilities: {
    execution: {
      run_task: { available: boolean; [key: string]: unknown };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  source_revision: SourceRevisionRef;
  status?: "already_available";
  task_catalog: TaskCatalogItem[];
  workspace_state_ref?: string;
  [key: string]: unknown;
};

export type AppliedChange = {
  proposal: PublicChangeProposal;
  receipt: CommitReceipt;
};

export class SemanticWorkspace {
  private readonly artifacts: ArtifactStore;
  private readonly changes: ChangeService;
  private readonly dependencies: DependencyMutationService;
  private readonly edits: EditService;
  private readonly files: WorkspaceFiles;
  private readonly inspections: InspectCodeService;
  private readonly memory: ConversationMemoryStore;
  private readonly relations: RelationService;
  private readonly references: ReferenceRegistry;
  private readonly review: ChangeReviewService;
  private readonly runs: RunService;
  private readonly taskContract?: SemanticWorkspaceOptions["taskContract"];
  private readonly workspaceStateReceipts = new Map<string, string>();

  constructor(workspaceRoot: string, options: SemanticWorkspaceOptions = {}) {
    this.files = new WorkspaceFiles(workspaceRoot);
    this.artifacts = new ArtifactStore(this.files.root);
    this.changes = new ChangeService(this.files, this.artifacts);
    this.dependencies = new DependencyMutationService(
      this.files,
      this.artifacts,
      options.taskExecutor,
      options.taskContract?.session_id,
    );
    this.edits = new EditService(
      this.files,
      this.changes,
      options.taskContract?.session_id,
    );
    this.inspections = new InspectCodeService(
      this.files,
      options.taskContract?.session_id,
    );
    this.memory = new ConversationMemoryStore(
      this.files.root,
      options.taskContract?.session_id ?? "unscoped-session",
    );
    this.references = new ReferenceRegistry(
      this.files.root,
      options.taskContract?.session_id ?? "unscoped-session",
    );
    this.relations = new RelationService(this.files);
    this.runs = new RunService(
      this.files,
      this.artifacts,
      this.changes,
      options.taskExecutor,
    );
    this.review = new ChangeReviewService(
      this.changes,
      this.files,
      this.relations,
      this.runs,
      new ValidationService(this.artifacts),
    );
    this.taskContract = options.taskContract;
  }

  async workspaceState(
    input: WorkspaceStateInput & { signal?: AbortSignal } = {},
  ): Promise<HarnessToolResult<WorkspaceStateData>> {
    const startedAt = Date.now();
    try {
      const { signal, ...publicInput } = input;
      const parsedInput = workspaceStateInputSchema.parse(publicInput);
      const snapshot = await this.files.snapshot(signal);
      const requestKey = workspaceStateRequestKey(snapshot, parsedInput);
      const workspaceStateRef = `workspace-state://${sha256(requestKey)}`;
      const previousReceipt = this.workspaceStateReceipts.get(requestKey);
      if (previousReceipt)
        return harnessSuccess({
          startedAt,
          revision: revisionVector(snapshot),
          provenance: [
            provenance(
              snapshot.git ? "git" : "filesystem",
              revisionVector(snapshot),
            ),
          ],
          outcome: "skipped",
          reason: "WORKSPACE_STATE_ALREADY_AVAILABLE",
          recommendation:
            "Use the previously returned workspace state receipt.",
          data: {
            status: "already_available",
            source_revision: snapshot.revision,
            workspace_state_ref: previousReceipt,
          } as WorkspaceStateData,
        });
      const environment = await new WorkspaceStateAuthority(
        this.files,
      ).environment(snapshot);
      const languages = Object.entries(
        countBy(
          snapshot.files.map(languageName).filter((name) => name !== "unknown"),
        ),
      )
        .sort((left, right) => right[1] - left[1])
        .map(([language, files]) => ({ language, files }));
      const dependencyMutation = await this.dependencies.capability(snapshot);
      const taskCatalog = await readTaskCatalog(
        this.files.root,
        snapshot.files,
        {
          dependencyTaskAvailable: dependencyMutation.install_available,
        },
      );
      const taskProjection = await workspaceTaskProjection({
        dependencyCapability: dependencyMutation,
        files: this.files,
        objective: this.taskContract?.objective,
        snapshot,
        tasks: taskCatalog,
      });
      const executionIsolation = await this.runs
        .capability()
        .then((value) => ({ available: true as const, isolation: value }))
        .catch((error) => ({
          available: false as const,
          reason: error instanceof Error ? error.message : String(error),
        }));
      await this.memory.recordOperationalState({
        architecture: [
          `Workspace manifests: ${
            taskProjection.packages.map(({ path }) => path).join(", ") || "none"
          }.`,
          `Detected frameworks: ${
            taskProjection.detected_frameworks.join(", ") || "none"
          }.`,
          `Package manager: ${dependencyMutation.package_manager}${
            dependencyMutation.package_manager_version
              ? `@${dependencyMutation.package_manager_version}`
              : ""
          }; network policy: ${dependencyMutation.network_policy}; cache: ${
            dependencyMutation.cache_available ? "available" : "empty"
          }.`,
        ],
        unavailableCapabilities: [
          ...(dependencyMutation.available
            ? []
            : [
                `Dependency mutation unavailable: ${
                  dependencyMutation.reason ?? "unknown reason"
                }`,
              ]),
          ...(executionIsolation.available
            ? []
            : [`Task execution unavailable: ${executionIsolation.reason}`]),
        ],
      });
      const tokenBudget = bounded(
        parsedInput.budget?.max_output_tokens,
        500,
        20_000,
        8_000,
      );
      const maximumChanges = Math.max(10, Math.floor(tokenBudget / 20));
      const maximumTasks = Math.max(5, Math.floor(tokenBudget / 30));
      const maximumRoots = Math.max(10, Math.floor(tokenBudget / 20));
      const topLevel = topLevelEntries(snapshot.files);
      const truncated =
        snapshot.changes.length > maximumChanges ||
        taskCatalog.length > maximumTasks ||
        topLevel.length > maximumRoots;
      const response = harnessSuccess({
        startedAt,
        revision: {
          ...revisionVector(snapshot),
          environment_spec_revision_id:
            environment.environment_spec_revision_id,
        },
        provenance: [
          provenance(snapshot.git ? "git" : "filesystem", {
            ...revisionVector(snapshot),
            environment_spec_revision_id:
              environment.environment_spec_revision_id,
          }),
        ],
        data: selectWorkspaceStateData(
          {
            source_revision: snapshot.revision,
            environment_spec: environment,
            task_contract: this.taskContract
              ? {
                  ...this.taskContract,
                  ...(this.taskContract.objective
                    ? {
                        objective: this.taskContract.objective.slice(0, 1_000),
                      }
                    : {}),
                }
              : null,
            repository: {
              root: this.files.root,
              git: snapshot.git,
              ...(snapshot.branch ? { branch: snapshot.branch } : {}),
            },
            capabilities: {
              semantic_workspace: {
                protocol_version: "3",
                languages: [
                  ...new Set(
                    capabilityRegistrySnapshot(snapshot.files).map(
                      (capability) => capability.languageId,
                    ),
                  ),
                ],
                views: [
                  "signature",
                  "declaration",
                  "body",
                  "neighborhood",
                  "raw",
                ],
                search: ["text", "symbol", "ast_pattern"],
                edit_operations: supportedCapabilityOperations(snapshot.files),
                feature_flags: harnessFeatureDefinitions(),
                language_capabilities: capabilityRegistrySnapshot(
                  snapshot.files,
                ),
                precision: "syntax",
                raw_fallback: true,
              },
              comprehension: {
                get_relation_context: {
                  available: true,
                  bounded: true,
                  semantic: {
                    activation: "on_demand",
                    cache: "source_revision_and_symbol",
                    engine: "typescript",
                    languages: ["javascript", "typescript"],
                    precision: "compiler",
                  },
                  fallback: {
                    analysis: "heuristic",
                    engine: "ripgrep",
                  },
                },
                review_change: ["semantic_diff", "impact"],
                validate_change: true,
              },
              execution: {
                run_task: executionIsolation,
                dependency_mutation: dependencyMutation,
                inspect_run: true,
                overlay: "copy_on_write_or_clone",
                network:
                  executionIsolation.available &&
                  executionIsolation.isolation === "worktree"
                    ? "host_with_proxy_hints"
                    : "default_deny",
                inherited_secrets: false,
                limits: {
                  timeout: true,
                  output_bytes: true,
                  cpu: false,
                  memory: false,
                },
                filesystem_effects: "captured_as_change_proposal",
              },
              services: {
                provider: "blame_preview_control_plane",
                lifecycle: ["start", "inspect", "restart", "stop"],
                port_allocation: "product_managed",
                run_task_services: false,
              },
              control_plane: {
                checkpoint: {
                  provider: "cline_session_checkpoint",
                  compare: true,
                  restore: true,
                },
                canonical_writer: "desktop_workspace_writer_registry",
                concurrent_writers: false,
              },
              artifacts: {
                content_addressed: true,
                encrypted_at_rest: true,
                agent_visibility: "agent_redacted_only",
                retention_days: {
                  agent_redacted: 30,
                  reviewer: 30,
                  sealed_raw: 7,
                },
              },
            },
            tree_summary: {
              file_count: snapshot.files.length,
              languages,
              top_level: topLevel.slice(0, maximumRoots),
            },
            task_projection: taskProjection,
            changes: snapshot.changes.slice(0, maximumChanges),
            task_catalog: taskCatalog.slice(0, maximumTasks),
          },
          parsedInput.include,
        ),
        coverage: {
          scope: truncated ? "partial" : "complete",
          truncated,
          analysis: "exact",
        },
      });
      Object.assign(response.data, { workspace_state_ref: workspaceStateRef });
      this.rememberWorkspaceStateReceipt(requestKey, workspaceStateRef);
      return this.references.shorten(response);
    } catch (error) {
      return toolError(error);
    }
  }

  private rememberWorkspaceStateReceipt(key: string, receipt: string) {
    this.workspaceStateReceipts.set(key, receipt);
    while (this.workspaceStateReceipts.size > 100)
      this.workspaceStateReceipts.delete(
        this.workspaceStateReceipts.keys().next().value!,
      );
  }

  async searchCode(
    input: SearchCodeInput,
    signal?: AbortSignal,
  ): Promise<
    HarnessToolResult<{
      engine: "ast-grep" | "node" | "ripgrep";
      items: SearchMatch[];
      query: SearchCodeInput["query"];
    }>
  > {
    const startedAt = Date.now();
    try {
      searchCodeInputSchema.parse(input);
      validateSearchInput(input);
      const snapshot = await this.files.snapshot(signal);
      const sourceRevision = snapshot.revision.source_revision_id;
      const candidates = scopedFiles(this.files, snapshot.files, input.scope);
      const maximum = bounded(input.max_results, 1, 100, 30);
      const tokenBudget = bounded(
        input.budget?.max_output_tokens,
        200,
        8_000,
        2_000,
      );
      const items: SearchMatch[] = [];
      let engine: "ast-grep" | "node" | "ripgrep" =
        input.query.kind === "text" ? "node" : "ast-grep";
      let engineTruncated = false;
      let candidatesToScan = candidates;
      if (input.query.kind === "text") {
        const lexical = await searchWithRipgrep({
          root: this.files.root,
          candidates,
          scopePaths: input.scope?.paths?.map((path) =>
            this.files.normalizePath(path),
          ),
          query: input.query,
          maximum,
          signal,
        });
        if (lexical.available) {
          engine = lexical.engine;
          engineTruncated = lexical.truncated;
          candidatesToScan = [];
          const contents = new Map<string, Buffer>();
          for (const match of lexical.items) {
            let content = contents.get(match.path);
            if (!content) {
              content = (await this.files.read(match.path)).content;
              contents.set(match.path, content);
            }
            const [start, end] = match.range_utf8_bytes;
            if (end > content.byteLength) continue;
            items.push(
              lexicalMatch(
                content,
                match.path,
                sourceRevision,
                [start, end],
                match.line_range,
                match.match_reason,
              ),
            );
          }
        }
      }
      for (const path of candidatesToScan) {
        signal?.throwIfAborted();
        if (items.length >= maximum || approximateTokens(items) >= tokenBudget)
          break;
        let content: Buffer;
        try {
          content = (await this.files.read(path)).content;
        } catch {
          continue;
        }
        if (content.length > maximumSemanticParseBytes || content.includes(0))
          continue;
        if (input.query.kind === "symbol") {
          const parsed = parseCode(path, content);
          for (const symbol of parsed.symbols) {
            if (!symbolNameMatches(symbol.name, input.query.name)) continue;
            if (
              input.query.kinds?.length &&
              !input.query.kinds.includes(symbol.kind)
            )
              continue;
            const materialized = materializeSymbol({
              symbol,
              path,
              revision: sourceRevision,
              content,
            });
            items.push({
              path,
              line_range: materialized.line_range,
              range_utf8_bytes: materialized.range_utf8_bytes,
              excerpt: materialized.signature,
              match_reason: "syntax_symbol_name",
              symbol_ref: materialized.symbol_ref,
            });
            if (items.length >= maximum) break;
          }
        } else if (input.query.kind === "ast_pattern") {
          if (
            input.query.language &&
            input.query.language !== languageName(path)
          )
            continue;
          const result = structuralMatches(
            path,
            content,
            input.query.pattern,
            maximum - items.length,
          );
          for (const match of result?.matches ?? []) {
            const [start, end] = match.range_utf8_bytes;
            items.push({
              path,
              line_range: match.line_range,
              range_utf8_bytes: match.range_utf8_bytes,
              excerpt: match.text,
              match_reason: `ast_pattern:${match.kind}`,
              node_ref: nodeRef(
                sourceRevision,
                path,
                content,
                start,
                end,
                match.kind,
              ),
            });
          }
        } else {
          items.push(
            ...textMatches(
              content,
              path,
              sourceRevision,
              input.query,
              maximum - items.length,
            ),
          );
        }
      }
      await this.ensureUnchanged(snapshot, signal);
      let budgetTruncated = false;
      while (items.length && approximateTokens(items) > tokenBudget) {
        items.pop();
        budgetTruncated = true;
      }
      const truncated =
        engineTruncated ||
        budgetTruncated ||
        items.length >= maximum ||
        approximateTokens(items) >= tokenBudget;
      const response = harnessSuccess({
        startedAt,
        revision: revisionVector(snapshot),
        provenance: [
          provenance(
            input.query.kind === "text" ? "lexical" : "parser",
            revisionVector(snapshot),
            items.map((item) => item.path),
          ),
        ],
        data: {
          engine,
          items: items.slice(0, maximum),
          query: input.query,
        },
        coverage: {
          scope: truncated ? "partial" : "complete",
          truncated,
          analysis: "exact",
        },
      });
      return this.references.shorten(response);
    } catch (error) {
      return toolError(error);
    }
  }

  async outlineCode(
    input: OutlineCodeInput,
    signal?: AbortSignal,
  ): Promise<
    HarnessToolResult<{
      auto_narrowed: boolean;
      continuation_targets: Array<{ path: string; reason: string }>;
      target: string;
      items: OutlineSymbol[];
      parse_quality: unknown[];
    }>
  > {
    const startedAt = Date.now();
    try {
      outlineCodeInputSchema.parse(input);
      validateOutlineInput(input);
      const snapshot = await this.files.snapshot(signal);
      const sourceRevision = snapshot.revision.source_revision_id;
      const target = this.files.normalizePath(input.target.path);
      const candidates = rankedOutlineCandidates(
        snapshot.files.filter(
          (path) =>
            path === target || target === "." || path.startsWith(`${target}/`),
        ),
        this.taskContract?.objective,
        snapshot.changes.map(({ path }) => path),
      );
      if (!candidates.length) throw new Error(`TARGET_GONE:${target}`);
      const maximum = bounded(
        input.budget?.max_items,
        1,
        outlineMaximumItems,
        outlineMaximumItems,
      );
      const tokenBudget = bounded(
        input.budget?.max_output_tokens,
        200,
        outlineMaximumOutputTokens,
        outlineMaximumOutputTokens,
      );
      const depth = bounded(input.depth, 1, 12, 3);
      const items: OutlineSymbol[] = [];
      const parseQuality: unknown[] = [];
      const processedPaths: string[] = [];
      let sourceTruncated = false;
      for (const path of candidates) {
        signal?.throwIfAborted();
        if (items.length >= maximum || approximateTokens(items) >= tokenBudget)
          break;
        const content = (await this.files.read(path)).content;
        processedPaths.push(path);
        if (content.length > maximumSemanticParseBytes) {
          parseQuality.push({
            path,
            reason: "semantic_parse_limit",
            size_bytes: content.length,
            supported: false,
          });
          sourceTruncated = true;
          continue;
        }
        const parsed = parseCode(path, content);
        parseQuality.push({
          path,
          language: parsed.language,
          supported: parsed.supported,
          syntax_errors: parsed.errorCount,
        });
        for (const symbol of rankedOutlineSymbols(
          parsed.symbols,
          this.taskContract?.objective,
        )) {
          if (symbol.qualified_name.split(".").length > depth) continue;
          if (input.kinds?.length && !input.kinds.includes(symbol.kind))
            continue;
          items.push(
            outlineSymbol(
              materializeSymbol({
                symbol,
                path,
                revision: sourceRevision,
                content,
              }),
              input.include,
            ),
          );
          if (items.length >= maximum) break;
        }
      }
      await this.ensureUnchanged(snapshot, signal);
      let budgetTruncated = false;
      while (
        parseQuality.length > 1 &&
        approximateTokens({ items, parse_quality: parseQuality }) > tokenBudget
      ) {
        parseQuality.pop();
        budgetTruncated = true;
      }
      while (
        items.length &&
        approximateTokens({ items, parse_quality: parseQuality }) > tokenBudget
      ) {
        items.pop();
        budgetTruncated = true;
      }
      const truncated =
        sourceTruncated ||
        budgetTruncated ||
        items.length >= maximum ||
        approximateTokens({ items, parse_quality: parseQuality }) >=
          tokenBudget;
      const continuationTargets = outlineContinuationTargets(
        candidates,
        processedPaths,
        target,
        truncated,
      );
      const response = harnessSuccess({
        startedAt,
        revision: revisionVector(snapshot),
        provenance: [
          provenance("parser", revisionVector(snapshot), processedPaths),
        ],
        data: {
          target,
          items,
          parse_quality: parseQuality,
          auto_narrowed:
            (input.budget?.max_items ?? outlineMaximumItems) >
              outlineMaximumItems ||
            (input.budget?.max_output_tokens ?? outlineMaximumOutputTokens) >
              outlineMaximumOutputTokens,
          continuation_targets: continuationTargets,
        },
        diagnostics: parseQuality.filter(
          (quality) =>
            !(quality as { supported?: boolean }).supported ||
            Number((quality as { syntax_errors?: number }).syntax_errors) > 0,
        ),
        coverage: {
          scope: truncated ? "partial" : "complete",
          truncated,
          analysis: "exact",
        },
      });
      return this.references.shorten(response);
    } catch (error) {
      return toolError(error);
    }
  }

  async inspectCode(
    input: InspectCodeInput,
    signal?: AbortSignal,
    context?: { contextEpoch?: string },
  ): Promise<HarnessToolResult<InspectCodeData>> {
    try {
      const expanded = await this.references.expand(input);
      const result = await this.inspections.inspect(expanded, signal, context);
      return this.references.shorten(result);
    } catch (error) {
      return toolError(error);
    }
  }

  async recallContext(input: RecallContextInput) {
    const startedAt = Date.now();
    try {
      const expanded = await this.references.expand(input);
      recallContextInputSchema.parse(expanded);
      const snapshot = await this.files.snapshot();
      const data = await this.memory.recall(expanded);
      const response = harnessSuccess({
        startedAt,
        revision: revisionVector(snapshot),
        provenance: [provenance("harness", revisionVector(snapshot))],
        data,
        coverage: {
          scope: data.truncated ? "partial" : "complete",
          truncated: data.truncated,
          analysis: "exact",
        },
      });
      return this.references.shorten(response);
    } catch (error) {
      if (error instanceof UnavailableReferences) {
        const snapshot = await this.files.snapshot();
        const revision = revisionVector(snapshot);
        return harnessSuccess({
          startedAt,
          revision,
          provenance: [provenance("harness", revision)],
          outcome: "unavailable",
          reason: "STALE_REFERENCE",
          recommendation:
            "Use the current compact references already present in the continuity checkpoint.",
          data: {
            stale_references: error.references,
            replacements: {},
          },
        });
      }
      return toolError(error);
    }
  }

  async getRelationContext(
    input: GetRelationContextInput,
    signal?: AbortSignal,
  ) {
    try {
      const expanded = await this.references.expand(input);
      const result = await this.relations.getRelationContext(expanded, signal);
      return this.references.shorten(result);
    } catch (error) {
      return toolError(error);
    }
  }

  editSymbol(
    input: EditSymbolInput,
    context?: { sessionId?: string; toolCallId?: string },
  ) {
    editSymbolInputSchema.parse(input);
    return this.editCode(
      {
        edits: [
          {
            operation: "replace_symbol",
            target: { symbol_ref: input.symbolRef },
            path: input.path,
            content: input.replacement,
          },
        ],
      },
      context,
    );
  }

  editJson(
    input: EditJsonInput,
    context?: { sessionId?: string; toolCallId?: string },
  ) {
    editJsonInputSchema.parse(input);
    return this.editCode(
      { edits: [{ operation: "edit_json", ...input }] },
      context,
    );
  }

  patchFile(
    input: PatchFileInput,
    context?: { sessionId?: string; toolCallId?: string },
  ) {
    patchFileInputSchema.parse(input);
    return this.editCode(
      { edits: [{ operation: "patch_file", ...input }] },
      context,
    );
  }

  editFiles(
    input: EditFilesInput,
    context?: { sessionId?: string; toolCallId?: string },
  ) {
    editFilesInputSchema.parse(input);
    return this.editCode(
      { atomicity: input.atomicity, edits: input.operations },
      context,
    );
  }

  createFile(
    input: CreateFileInput,
    context?: { sessionId?: string; toolCallId?: string },
  ) {
    createFileInputSchema.parse(input);
    return this.editCode(
      { edits: [{ operation: "create_file", ...input }] },
      context,
    );
  }

  replaceFile(
    input: ReplaceFileInput,
    context?: { sessionId?: string; toolCallId?: string },
  ) {
    replaceFileInputSchema.parse(input);
    return this.editCode(
      { edits: [{ operation: "replace_file", ...input }] },
      context,
    );
  }

  deleteFile(
    input: DeleteFileInput,
    context?: { sessionId?: string; toolCallId?: string },
  ) {
    deleteFileInputSchema.parse(input);
    return this.editCode(
      { edits: [{ operation: "delete_file", ...input }] },
      context,
    );
  }

  moveFile(
    input: MoveFileInput,
    context?: { sessionId?: string; toolCallId?: string },
  ) {
    moveFileInputSchema.parse(input);
    return this.editCode(
      {
        edits: [
          {
            operation: "move_file",
            from_path: input.fromPath,
            to_path: input.toPath,
          },
        ],
      },
      context,
    );
  }

  async editCode(
    input: EditCodeInput,
    context?: { sessionId?: string; toolCallId?: string },
  ): Promise<HarnessToolResult<EditCodeOutcome>> {
    const startedAt = Date.now();
    try {
      const expanded = await this.references.expand(input);
      editCodeInputSchema.parse(expanded);
      const result = await this.edits.edit(expanded, context);
      if (result.status === "applied") await this.rememberEdit(result);
      if (result.status === "conflict")
        await this.memory.recordRuntimeEvent(
          "edit_conflict",
          context?.toolCallId ?? JSON.stringify(expanded),
          result.reason,
        );
      if (result.status === "validation_failed")
        await this.memory.recordRuntimeEvent(
          "rollback",
          context?.toolCallId ?? JSON.stringify(expanded),
          "validation_failed",
        );
      const response = await editCodeResponse(
        this.files,
        this.artifacts,
        result,
        startedAt,
      );
      return this.references.shorten(response);
    } catch (error) {
      return toolError(error);
    }
  }

  applyChange(
    input: ProposeChangeInput,
    signal?: AbortSignal,
  ): Promise<HarnessToolResult<PublicChangeProposal>>;
  applyChange(
    input: CommitProposalInput,
    signal?: AbortSignal,
  ): Promise<HarnessToolResult<CommitReceipt>>;
  applyChange(
    input: DirectApplyChangeInput,
    signal?: AbortSignal,
  ): Promise<HarnessToolResult<AppliedChange>>;
  applyChange(
    input: ApplyChangeInput,
    signal?: AbortSignal,
  ): Promise<
    HarnessToolResult<PublicChangeProposal | CommitReceipt | AppliedChange>
  >;
  async applyChange(input: ApplyChangeInput, signal?: AbortSignal) {
    const startedAt = Date.now();
    try {
      const expanded = await this.references.expand(input);
      applyChangeInputSchema.parse(expanded);
      signal?.throwIfAborted();
      if (expanded.action === "apply") {
        const applied = await this.changes.apply(expanded);
        const revision = {
          source_revision_id:
            applied.receipt.source_revision.source_revision_id,
        };
        const response = harnessSuccess({
          startedAt,
          revision,
          provenance: [provenance("harness", revision)],
          data: {
            proposal: publicProposal(applied.proposal),
            receipt: applied.receipt,
          },
          artifacts: [applied.proposal.diff_artifact],
          diagnostics: applied.proposal.diagnostics,
          coverage: {
            scope: applied.proposal.diff_summary_truncated
              ? "partial"
              : "complete",
            truncated: applied.proposal.diff_summary_truncated ?? false,
            analysis: "exact",
            ...(applied.proposal.diff_summary_truncated
              ? { continuation: "0" }
              : {}),
          },
        });
        return this.references.shorten(response);
      }
      if (expanded.action === "propose") {
        const snapshot = await this.exactSnapshot(
          expanded.base_source_revision_id,
          signal,
        );
        const proposal = await this.changes.propose(expanded, snapshot);
        const response = harnessSuccess({
          startedAt,
          revision: revisionVector(snapshot),
          provenance: [provenance("harness", revisionVector(snapshot))],
          data: publicProposal(proposal),
          artifacts: [proposal.diff_artifact],
          diagnostics: proposal.diagnostics,
          coverage: {
            scope: proposal.diff_summary_truncated ? "partial" : "complete",
            truncated: proposal.diff_summary_truncated ?? false,
            analysis: "exact",
            ...(proposal.diff_summary_truncated ? { continuation: "0" } : {}),
          },
        });
        return this.references.shorten(response);
      }
      const receipt = await this.changes.commit(expanded);
      const revision = {
        source_revision_id: receipt.source_revision.source_revision_id,
      };
      const response = harnessSuccess({
        startedAt,
        revision,
        provenance: [provenance("harness", revision)],
        data: receipt,
      });
      return this.references.shorten(response);
    } catch (error) {
      return toolError(error);
    }
  }

  async runTask(
    input: RunTaskInput,
    signal?: AbortSignal,
    context?: { sessionId?: string; toolCallId?: string },
  ): Promise<ReturnType<typeof runTaskResponse>> {
    const startedAt = Date.now();
    try {
      runTaskInputSchema.parse(input);
      const snapshot = await this.exactSnapshot(
        input.source_revision_id,
        signal,
      );
      if (dependencyTaskRequested(input)) {
        const capability = await this.dependencies.capability(snapshot);
        if (!capability.install_available) {
          const unavailable = await this.dependencies.openUnavailable(
            snapshot,
            capability.reason ?? "DEPENDENCY_EXECUTOR_UNAVAILABLE",
          );
          return dependencyUnavailableResponse(
            unavailable,
            snapshot.revision.source_revision_id,
            startedAt,
          ) as unknown as ReturnType<typeof runTaskResponse>;
        }
      }
      const run = await this.runs.run(input, snapshot, signal, context);
      if (
        run.task.kind === "dependencies" &&
        run.status === "execution_error" &&
        this.dependencies.isCapabilityFailure(run.logs.stderr_tail)
      ) {
        const capability = await this.dependencies.openUnavailable(
          snapshot,
          run.logs.stderr_tail,
        );
        return dependencyUnavailableResponse(
          capability,
          snapshot.revision.source_revision_id,
          startedAt,
        ) as unknown as ReturnType<typeof runTaskResponse>;
      }
      await this.memory.recordValidation({
        command: run.task.command,
        environmentRevisionId: run.environment_spec_revision_id,
        id: run.run_ref,
        sourceRevisionId: run.source_revision.source_revision_id,
        status: run.status,
        taskId: run.task.task_id,
        taskKind: run.task.kind,
        terminal:
          run.status === "passed"
            ? "passed"
            : run.status === "failed"
              ? "failed"
              : "unknown",
      });
      return runTaskResponse(run, startedAt);
    } catch (error) {
      return toolError(error);
    }
  }

  async mutateDependencies(
    input: DependencyMutationInput,
    signal?: AbortSignal,
  ) {
    const startedAt = Date.now();
    try {
      const snapshot = await this.exactSnapshot(
        input.source_revision_id,
        signal,
      );
      const data = await this.dependencies.mutate(input, snapshot, signal);
      if ("status" in data && data.status === "applied")
        await this.memory.recordChange({
          receiptId: data.change_set_ref,
          sourceRevisionId: data.source_revision_id,
          files: data.changed_files,
          symbols: [],
          summary: `Updated dependencies in ${data.package_path}`,
          validation: "not_run",
        });
      const unavailable =
        !("status" in data) && "dependencies_already_available" in data;
      if (unavailable)
        await this.memory.recordOperationalState({
          architecture: [],
          nextFocus: input.package_path,
          unavailableCapabilities: [
            `Dependency mutation unavailable: ${data.reason}`,
          ],
        });
      const revision = {
        source_revision_id:
          "source_revision_id" in data
            ? data.source_revision_id
            : snapshot.revision.source_revision_id,
      };
      return harnessSuccess({
        startedAt,
        revision,
        provenance: [provenance("harness", revision)],
        data,
        ...(unavailable
          ? {
              outcome: "unavailable" as const,
              reason: data.reason,
              recommendation:
                "Reuse an existing dependency, implement without it, or report the blocker.",
            }
          : {}),
      });
    } catch (error) {
      return toolError(error);
    }
  }

  async inspectRun(input: InspectRunInput, signal?: AbortSignal) {
    const startedAt = Date.now();
    try {
      inspectRunInputSchema.parse(input);
      signal?.throwIfAborted();
      const run = await this.runs.read(input.run_ref);
      const data = await this.runs.inspect(input);
      const revision = {
        source_revision_id: run.source_revision.source_revision_id,
        environment_spec_revision_id: run.environment_spec_revision_id,
        runtime_instance_id: run.runtime_instance_id,
      };
      return harnessSuccess({
        startedAt,
        revision,
        provenance: [provenance("harness", revision)],
        data,
        artifacts: [run.logs.complete, run.filesystem_effects.artifact],
        coverage: {
          scope: run.logs.output_truncated ? "partial" : "complete",
          truncated: run.logs.output_truncated,
          analysis: "observed_subset",
        },
      });
    } catch (error) {
      return toolError(error);
    }
  }

  async inspectArtifact(input: InspectArtifactInput, signal?: AbortSignal) {
    const startedAt = Date.now();
    try {
      inspectArtifactInputSchema.parse(input);
      signal?.throwIfAborted();
      const metadata = await this.artifacts.metadata(input.artifact_ref, {
        audience: "agent",
      });
      const tokenBudget = bounded(
        input.budget?.max_output_tokens,
        100,
        20_000,
        2_500,
      );
      const maximumBytes = tokenBudget * (input.view === "bytes" ? 3 : 4);
      const offset = input.offset_bytes ?? 0;
      if (input.view === "metadata")
        return harnessSuccess({
          startedAt,
          revision: metadata.subject_revision ?? {},
          provenance: [provenance("harness", metadata.subject_revision ?? {})],
          data: { artifact: metadata },
        });
      const content = await this.artifacts.get(input.artifact_ref, {
        audience: "agent",
      });
      if (offset > content.byteLength)
        throw new Error("Artifact offset is outside the content.");
      if (input.view === "json" && offset !== 0)
        throw new Error(
          "JSON artifacts must be inspected from offset 0. Use text view for byte paging.",
        );
      if (input.view === "json" && content.byteLength > maximumBytes)
        throw new Error(
          "JSON artifact exceeds this output budget. Increase the budget or use text view with continuation offsets.",
        );
      if (
        input.view === "text" &&
        offset > 0 &&
        (content[offset]! & 0xc0) === 0x80
      )
        throw new Error("Text artifact offset is not a UTF-8 boundary.");
      const selectedLength =
        input.view === "text"
          ? utf8PrefixLength(content.subarray(offset), maximumBytes)
          : Math.min(maximumBytes, content.byteLength - offset);
      const selected = content.subarray(offset, offset + selectedLength);
      const truncated = offset + selected.byteLength < content.byteLength;
      let value: unknown;
      if (input.view === "bytes") value = selected.toString("base64");
      else if (input.view === "json")
        value = JSON.parse(selected.toString("utf8"));
      else value = selected.toString("utf8");
      return harnessSuccess({
        startedAt,
        revision: metadata.subject_revision ?? {},
        provenance: [provenance("harness", metadata.subject_revision ?? {})],
        data: {
          artifact: metadata,
          view: input.view,
          offset_bytes: offset,
          content: value,
          omitted_bytes: Math.max(
            0,
            content.byteLength - offset - selected.byteLength,
          ),
        },
        coverage: {
          scope: truncated ? "partial" : "complete",
          truncated,
          analysis: "exact",
          ...(truncated
            ? { continuation: String(offset + selected.byteLength) }
            : {}),
        },
      });
    } catch (error) {
      return toolError(error);
    }
  }

  async reviewChange(input: ReviewChangeInput, signal?: AbortSignal) {
    return this.review.reviewChange(input, signal);
  }

  async validateChange(input: ValidateChangeInput, signal?: AbortSignal) {
    const result = await this.review.validateChange(input, signal);
    if (result.status !== "success") return result;
    const data = result.data as {
      evidence_ref?: string;
      summary?: { complete?: boolean };
    };
    if (data.evidence_ref)
      await this.memory.recordRuntimeEvent(
        "validation",
        data.evidence_ref,
        data.summary?.complete ? "passed" : "incomplete",
      );
    return result;
  }

  private async rememberEdit(
    result: Extract<EditCodeOutcome, { status: "applied" }>,
  ) {
    const paths = result.changed_files.map((file) => file.path);
    await this.inspections.invalidatePaths(paths);
    for (const receipt of result.file_receipts)
      await this.memory.recordChange({
        artifactRef: receipt.diff_artifact_ref,
        receiptId: receipt.receipt_ref,
        sourceRevisionId: result.source_revision,
        files: receipt.paths,
        symbols: changedSymbolNames(
          result.changed_symbols.filter((change) =>
            receipt.paths.includes(change.path),
          ),
        ),
        summary: result.changed_files
          .filter((file) => receipt.paths.includes(file.path))
          .map((file) => `${file.path} (+${file.additions}/-${file.deletions})`)
          .join(", "),
        validation: memoryValidation(result.validation.status),
      });
  }

  private async exactSnapshot(expected: string, signal?: AbortSignal) {
    const snapshot = await this.files.snapshot(signal);
    if (snapshot.revision.source_revision_id !== expected)
      throw staleRevision(snapshot.revision.source_revision_id);
    return snapshot;
  }

  private async ensureUnchanged(
    snapshot: WorkspaceSnapshot,
    signal?: AbortSignal,
  ) {
    const current = await this.files.snapshot(signal);
    if (
      current.revision.source_revision_id !==
      snapshot.revision.source_revision_id
    )
      throw staleRevision(current.revision.source_revision_id);
  }
}

function utf8PrefixLength(content: Buffer, maximumBytes: number) {
  if (content.byteLength <= maximumBytes) return content.byteLength;
  let end = maximumBytes;
  while (end > 0 && (content[end]! & 0xc0) === 0x80) end -= 1;
  return end;
}

function changedSymbolNames(
  changes: Extract<EditCodeOutcome, { status: "applied" }>["changed_symbols"],
) {
  return changes.flatMap((change) =>
    [...change.added, ...change.modified, ...change.removed].flatMap(
      (symbol) => {
        if (typeof symbol === "string") return [symbol];
        if (!symbol || typeof symbol !== "object") return [];
        const value = symbol as { qualified_name?: unknown; name?: unknown };
        const name = value.qualified_name ?? value.name;
        return typeof name === "string" ? [name] : [];
      },
    ),
  );
}

function memoryValidation(status: ValidationStatus) {
  if (status === "passed") return "passed" as const;
  if (status === "failed") return "failed" as const;
  return "not_supported" as const;
}

function editArtifactRefs(result: EditCodeOutcome) {
  if (result.status === "applied") return result.diff_artifact_refs;
  if (result.status === "validation_failed")
    return [result.proposed_diff_artifact_ref];
  return [];
}

function editDiagnostics(result: EditCodeOutcome) {
  if (result.status === "applied") return result.validation.diagnostics;
  if (result.status === "validation_failed") return result.diagnostics;
  return [];
}

async function editCodeResponse(
  files: WorkspaceFiles,
  artifacts: ArtifactStore,
  result: EditCodeOutcome,
  startedAt: number,
) {
  const revision = {
    source_revision_id:
      result.status === "applied"
        ? result.source_revision
        : (await files.snapshot()).revision.source_revision_id,
  };
  const artifactMetadata = await Promise.all(
    editArtifactRefs(result).map((reference) =>
      artifacts.metadata(reference, { audience: "agent" }),
    ),
  );
  const diagnostics = editDiagnostics(result);
  return harnessSuccess({
    startedAt,
    revision,
    provenance: [provenance("harness", revision)],
    data: result,
    ...(result.status === "applied" && result.partial
      ? {
          reason: "PARTIAL_BATCH_APPLIED",
          recommendation:
            "Continue from the returned source revision. failed_operations were not applied; skipped_operations made no mutation and need no retry when their requested end state is already present. Retry only a specific operation whose required result is still absent.",
        }
      : {}),
    ...(artifactMetadata.length ? { artifacts: artifactMetadata } : {}),
    ...(diagnostics.length ? { diagnostics } : {}),
  });
}

function runTaskResponse(
  run: Awaited<ReturnType<RunService["run"]>>,
  startedAt: number,
) {
  const revision = {
    source_revision_id: run.source_revision.source_revision_id,
    environment_spec_revision_id: run.environment_spec_revision_id,
    runtime_instance_id: run.runtime_instance_id,
  };
  const summary = publicRun(run);
  if (run.status === "execution_error")
    return harnessError({
      code: "EXECUTION_ERROR",
      message:
        summary.stderr_summary ??
        "The task executor failed before producing a valid task result.",
      revision,
      recovery: summary,
      recommendation:
        "The task runtime is unavailable. Do not edit project files, manifests, scripts, or lockfiles to repair it, and do not rerun the same task until the runtime environment changes.",
    });
  const semantics = runTaskResponseSemantics(run.status);
  return harnessSuccess({
    startedAt,
    revision,
    provenance: [provenance("harness", revision)],
    data: summary,
    ...semantics,
    artifacts: [run.logs.complete, run.filesystem_effects.artifact],
    diagnostics: run.diagnostics,
    coverage: {
      scope: run.logs.output_truncated ? "partial" : "complete",
      truncated: run.logs.output_truncated,
      analysis: "observed_subset",
    },
  });
}

function runTaskResponseSemantics(
  status: Awaited<ReturnType<RunService["run"]>>["status"],
) {
  if (status === "passed")
    return {
      outcome: "completed" as const,
      reason: "TASK_PASSED",
      recommendation: "Continue with the task using this validation evidence.",
    };
  const reason =
    status === "timed_out"
      ? "TASK_TIMED_OUT"
      : status === "cancelled"
        ? "TASK_CANCELLED"
        : "TASK_FAILED";
  return {
    outcome: "blocked" as const,
    reason,
    recommendation:
      "Use the returned diagnostics and log artifact to fix the reported cause. Do not rerun the identical task until code, dependencies, or environment state changed.",
  };
}

function dependencyTaskRequested(input: RunTaskInput) {
  return (
    ("task_id" in input.task && input.task.task_id === "dependencies") ||
    ("kind" in input.task && input.task.kind === "dependencies")
  );
}

function dependencyUnavailableResponse(
  capability: Awaited<ReturnType<DependencyMutationService["capability"]>>,
  sourceRevisionId: string,
  startedAt: number,
) {
  const revision = { source_revision_id: sourceRevisionId };
  return harnessSuccess({
    startedAt,
    revision,
    provenance: [provenance("harness", revision)],
    data: { ...capability, recovery_depth: 0 },
    diagnostics: [
      {
        code: "DEPENDENCY_EXECUTOR_UNAVAILABLE",
        message:
          "Dependency mutation is unavailable in the active executor. No executor call was made.",
      },
    ],
    coverage: { scope: "complete", truncated: false, analysis: "exact" },
  });
}

function rankedOutlineCandidates(
  paths: string[],
  objective: string | undefined,
  changedPaths: string[],
) {
  const terms = outlineTerms(objective);
  const changed = new Set(changedPaths);
  return [...paths].sort((left, right) => {
    const difference =
      outlineRelevance(right, terms, changed.has(right)) -
      outlineRelevance(left, terms, changed.has(left));
    return difference || left.localeCompare(right);
  });
}

function rankedOutlineSymbols(
  symbols: ReturnType<typeof parseCode>["symbols"],
  objective?: string,
) {
  const terms = outlineTerms(objective);
  return [...symbols].sort((left, right) => {
    const difference =
      outlineRelevance(right.qualified_name, terms, false) -
      outlineRelevance(left.qualified_name, terms, false);
    return difference || left.range_utf8_bytes[0] - right.range_utf8_bytes[0];
  });
}

function outlineContinuationTargets(
  candidates: string[],
  processedPaths: string[],
  target: string,
  truncated: boolean,
) {
  if (!truncated) return [];
  const processed = new Set(processedPaths);
  const remaining = candidates.filter((path) => !processed.has(path));
  const paths = remaining.length ? remaining.slice(0, 8) : [target];
  return paths.map((path) => ({
    path,
    reason: remaining.length
      ? "highest_relevance_unread"
      : "narrow_by_symbol_name_or_kind",
  }));
}

function outlineTerms(objective?: string) {
  return [
    ...new Set(
      (objective ?? "")
        .normalize("NFKC")
        .toLowerCase()
        .match(/[\p{L}\p{N}_-]{3,}/gu) ?? [],
    ),
  ].slice(0, 40);
}

function outlineRelevance(value: string, terms: string[], changed: boolean) {
  const normalized = value.toLowerCase();
  const compact = normalized.replace(/[^\p{L}\p{N}]/gu, "");
  return terms.reduce(
    (score, term) =>
      score +
      (normalized.includes(term) ||
      compact.includes(term.replace(/[^\p{L}\p{N}]/gu, ""))
        ? 10
        : 0),
    changed ? 100 : 0,
  );
}

function selectWorkspaceStateData<T extends Record<string, unknown>>(
  data: T,
  include?: string[],
): T {
  if (!include) return data;
  return Object.fromEntries(
    include.flatMap((key) => (key in data ? [[key, data[key]]] : [])),
  ) as T;
}

function workspaceStateRequestKey(
  snapshot: WorkspaceSnapshot,
  input: WorkspaceStateInput,
) {
  return JSON.stringify({
    source_revision: snapshot.revision,
    include: [...(input.include ?? [])].sort(),
    budget: input.budget ?? null,
  });
}
