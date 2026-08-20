import { ArtifactStore } from "./artifact-store.js";
import { environmentSpec } from "./environment-service.js";
import {
  findExactNode,
  inspectParsedNode,
  materializeSymbol,
  parseCode,
  structuralMatches,
  type CodeSymbol,
} from "./code-intelligence.js";
import {
  ChangeService,
  type ApplyChangeInput,
  type CommitProposalInput,
  type CommitReceipt,
  type ProposeChangeInput,
} from "./change-service.js";
import {
  harnessSuccess,
  provenance,
  sha256,
  type HarnessToolResult,
} from "./protocol.js";
import {
  approximateTokens,
  bounded,
  compareSymbols,
  countBy,
  inspectTarget,
  nodeRef,
  publicProposal,
  revisionVector,
  scopedFiles,
  staleRevision,
  symbolNameMatches,
  textMatches,
  toolError,
  topLevelEntries,
  validRange,
  validateInspectInput,
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
import { readTaskCatalog } from "./task-catalog.js";
import type { TaskExecutor } from "./task-executor.js";
import {
  languageName,
  WorkspaceFiles,
  type WorkspaceSnapshot,
} from "./workspace-files.js";
import { searchWithRipgrep } from "./lexical-search.js";
import {
  applyChangeInputSchema,
  inspectCodeInputSchema,
  inspectArtifactInputSchema,
  inspectRunInputSchema,
  outlineCodeInputSchema,
  reviewChangeInputSchema,
  runTaskInputSchema,
  searchCodeInputSchema,
  workspaceStateInputSchema,
  type WorkspaceStateInput,
  type InspectArtifactInput,
  type InspectRunInput,
  type RunTaskInput,
} from "./schemas.js";

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
    session_id?: string;
    story_id?: string;
    objective?: string;
  };
};

export class SemanticWorkspace {
  private readonly artifacts: ArtifactStore;
  private readonly changes: ChangeService;
  private readonly files: WorkspaceFiles;
  private readonly runs: RunService;
  private readonly taskContract?: SemanticWorkspaceOptions["taskContract"];

  constructor(workspaceRoot: string, options: SemanticWorkspaceOptions = {}) {
    this.files = new WorkspaceFiles(workspaceRoot);
    this.artifacts = new ArtifactStore(this.files.root);
    this.changes = new ChangeService(this.files, this.artifacts);
    this.runs = new RunService(
      this.files,
      this.artifacts,
      this.changes,
      options.taskExecutor,
    );
    this.taskContract = options.taskContract;
  }

  async workspaceState(
    input: WorkspaceStateInput & { signal?: AbortSignal } = {},
  ) {
    const startedAt = Date.now();
    try {
      const { signal, ...publicInput } = input;
      workspaceStateInputSchema.parse(publicInput);
      const snapshot = await this.files.snapshot(signal);
      const environment = await environmentSpec(this.files, snapshot);
      const languages = Object.entries(
        countBy(
          snapshot.files.map(languageName).filter((name) => name !== "unknown"),
        ),
      )
        .sort((left, right) => right[1] - left[1])
        .map(([language, files]) => ({ language, files }));
      const taskCatalog = await readTaskCatalog(this.files.root);
      const executionIsolation = await this.runs
        .capability()
        .then((value) => ({ available: true as const, isolation: value }))
        .catch((error) => ({
          available: false as const,
          reason: error instanceof Error ? error.message : String(error),
        }));
      const tokenBudget = bounded(
        input.budget?.max_output_tokens,
        200,
        4_000,
        1_200,
      );
      const maximumChanges = Math.max(10, Math.floor(tokenBudget / 20));
      const maximumTasks = Math.max(5, Math.floor(tokenBudget / 30));
      const maximumRoots = Math.max(10, Math.floor(tokenBudget / 20));
      const topLevel = topLevelEntries(snapshot.files);
      const truncated =
        snapshot.changes.length > maximumChanges ||
        taskCatalog.length > maximumTasks ||
        topLevel.length > maximumRoots;
      return harnessSuccess({
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
        data: {
          source_revision: snapshot.revision,
          environment_spec: environment,
          task_contract: this.taskContract
            ? {
                ...this.taskContract,
                ...(this.taskContract.objective
                  ? { objective: this.taskContract.objective.slice(0, 1_000) }
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
              languages: ["typescript", "javascript"],
              views: [
                "signature",
                "declaration",
                "body",
                "neighborhood",
                "raw",
              ],
              search: ["text", "symbol", "ast_pattern"],
              edit_operations: [
                "replace_node",
                "insert_before",
                "insert_after",
                "text_replace",
                "create_file",
                "delete_file",
                "move_file",
              ],
              precision: "syntax",
              raw_fallback: true,
            },
            execution: {
              run_task: executionIsolation,
              inspect_run: true,
              overlay: "copy_on_write_or_clone",
              network: "default_deny",
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
          changes: snapshot.changes.slice(0, maximumChanges),
          task_catalog: taskCatalog.slice(0, maximumTasks),
        },
        coverage: {
          scope: truncated ? "partial" : "complete",
          truncated,
          analysis: "exact",
        },
      });
    } catch (error) {
      return toolError(error);
    }
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
      const snapshot = await this.exactSnapshot(
        input.source_revision_id,
        signal,
      );
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
            items.push({
              ...match,
              node_ref: nodeRef(
                input.source_revision_id,
                match.path,
                content,
                start,
                end,
                "text_match",
              ),
            });
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
        if (content.length > 2 * 1024 * 1024 || content.includes(0)) continue;
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
              revision: input.source_revision_id,
              blobHash: sha256(content),
              language: parsed.language,
              content,
            });
            items.push({
              path,
              line_range: materialized.line_range,
              range_utf8_bytes: materialized.range_utf8_bytes,
              excerpt: materialized.signature,
              match_reason: "syntax_symbol_name",
              node_ref: materialized.node_ref.ref,
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
                input.source_revision_id,
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
              input.source_revision_id,
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
      return harnessSuccess({
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
    } catch (error) {
      return toolError(error);
    }
  }

  async outlineCode(
    input: OutlineCodeInput,
    signal?: AbortSignal,
  ): Promise<
    HarnessToolResult<{
      target: string;
      items: CodeSymbol[];
      parse_quality: unknown[];
    }>
  > {
    const startedAt = Date.now();
    try {
      outlineCodeInputSchema.parse(input);
      validateOutlineInput(input);
      const snapshot = await this.exactSnapshot(
        input.source_revision_id,
        signal,
      );
      const target = this.files.normalizePath(input.target.path);
      const candidates = snapshot.files.filter(
        (path) =>
          path === target || target === "." || path.startsWith(`${target}/`),
      );
      if (!candidates.length) throw new Error(`TARGET_GONE:${target}`);
      const maximum = bounded(input.budget?.max_items, 1, 500, 80);
      const tokenBudget = bounded(
        input.budget?.max_output_tokens,
        200,
        12_000,
        3_000,
      );
      const depth = bounded(input.depth, 1, 12, 3);
      const items: CodeSymbol[] = [];
      const parseQuality: unknown[] = [];
      for (const path of candidates) {
        signal?.throwIfAborted();
        if (items.length >= maximum || approximateTokens(items) >= tokenBudget)
          break;
        const content = (await this.files.read(path)).content;
        if (content.length > 2 * 1024 * 1024) continue;
        const parsed = parseCode(path, content);
        parseQuality.push({
          path,
          language: parsed.language,
          supported: parsed.supported,
          syntax_errors: parsed.errorCount,
        });
        for (const symbol of parsed.symbols) {
          if (symbol.qualified_name.split(".").length > depth) continue;
          if (input.kinds?.length && !input.kinds.includes(symbol.kind))
            continue;
          items.push(
            materializeSymbol({
              symbol,
              path,
              revision: input.source_revision_id,
              blobHash: sha256(content),
              language: parsed.language,
              content,
            }),
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
        budgetTruncated ||
        items.length >= maximum ||
        approximateTokens({ items, parse_quality: parseQuality }) >=
          tokenBudget;
      return harnessSuccess({
        startedAt,
        revision: revisionVector(snapshot),
        provenance: [
          provenance("parser", revisionVector(snapshot), candidates),
        ],
        data: { target, items, parse_quality: parseQuality },
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
    } catch (error) {
      return toolError(error);
    }
  }

  async inspectCode(input: InspectCodeInput, signal?: AbortSignal) {
    const startedAt = Date.now();
    try {
      inspectCodeInputSchema.parse(input);
      validateInspectInput(input);
      const snapshot = await this.exactSnapshot(
        input.source_revision_id,
        signal,
      );
      const target = inspectTarget(input.target);
      if (target.handle && target.handle.revision !== input.source_revision_id)
        throw staleRevision(snapshot.revision.source_revision_id);
      const path = this.files.normalizePath(
        target.handle?.path ?? target.path!,
      );
      let content: Buffer;
      try {
        content = (await this.files.read(path)).content;
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        )
          throw new Error(`TARGET_GONE:${path}`);
        throw error;
      }
      const fileRef = await this.files.fileRef(
        path,
        input.source_revision_id,
        content,
      );
      const maximumBytes =
        bounded(input.budget?.max_output_tokens, 100, 20_000, 2_500) * 4;
      let inspected: { content: string; range_utf8_bytes: [number, number] };
      let analysis: "exact" | "heuristic" = "exact";
      if (input.view === "raw") {
        const range = input.range_utf8_bytes
          ? validRange(input.range_utf8_bytes, content.length)
          : ([0, content.length] as [number, number]);
        inspected = {
          content: content.subarray(...range).toString("utf8"),
          range_utf8_bytes: range,
        };
      } else {
        if (!target.handle)
          throw new Error(
            "A symbol_ref or node_ref is required for structured views.",
          );
        const fragment = content.subarray(
          target.handle.start,
          target.handle.end,
        );
        if (sha256(fragment) !== target.handle.digest)
          throw new Error(`TARGET_GONE:${path}`);
        const parsed = parseCode(path, content);
        const node = findExactNode(
          parsed,
          content,
          target.handle.start,
          target.handle.end,
          target.handle.digest,
        );
        if (!node) throw new Error(`UNSUPPORTED_STRUCTURE:${path}`);
        inspected = inspectParsedNode({ content, node, view: input.view });
        analysis = parsed.errorCount ? "heuristic" : "exact";
      }
      const bytes = Buffer.from(inspected.content);
      const selectedBytes = utf8PrefixLength(bytes, maximumBytes);
      const truncated = selectedBytes < bytes.length;
      const returned = bytes.subarray(0, selectedBytes).toString("utf8");
      await this.ensureUnchanged(snapshot, signal);
      return harnessSuccess({
        startedAt,
        revision: revisionVector(snapshot),
        provenance: [
          provenance(
            input.view === "raw" ? "filesystem" : "parser",
            revisionVector(snapshot),
            [path],
          ),
        ],
        data: {
          path,
          file_ref: fileRef,
          view: input.view,
          content: returned,
          range_utf8_bytes: inspected.range_utf8_bytes,
          omitted_bytes: bytes.length - selectedBytes,
        },
        coverage: {
          scope: truncated ? "partial" : "complete",
          truncated,
          analysis,
          ...(truncated
            ? {
                continuation: `${inspected.range_utf8_bytes[0] + selectedBytes}`,
              }
            : {}),
        },
      });
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
    input: ApplyChangeInput,
    signal?: AbortSignal,
  ): Promise<HarnessToolResult<PublicChangeProposal | CommitReceipt>>;
  async applyChange(input: ApplyChangeInput, signal?: AbortSignal) {
    const startedAt = Date.now();
    try {
      applyChangeInputSchema.parse(input);
      signal?.throwIfAborted();
      if (input.action === "propose") {
        const snapshot = await this.exactSnapshot(
          input.base_source_revision_id,
          signal,
        );
        const proposal = await this.changes.propose(input, snapshot);
        return harnessSuccess({
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
      }
      const receipt = await this.changes.commit(input);
      const revision = {
        source_revision_id: receipt.source_revision.source_revision_id,
      };
      return harnessSuccess({
        startedAt,
        revision,
        provenance: [provenance("harness", revision)],
        data: receipt,
      });
    } catch (error) {
      return toolError(error);
    }
  }

  async runTask(input: RunTaskInput, signal?: AbortSignal) {
    const startedAt = Date.now();
    try {
      runTaskInputSchema.parse(input);
      const snapshot = await this.exactSnapshot(
        input.source_revision_id,
        signal,
      );
      const run = await this.runs.run(input, snapshot, signal);
      const revision = {
        source_revision_id: run.source_revision.source_revision_id,
        environment_spec_revision_id: run.environment_spec_revision_id,
        runtime_instance_id: run.runtime_instance_id,
      };
      return harnessSuccess({
        startedAt,
        revision,
        provenance: [provenance("harness", revision)],
        data: publicRun(run),
        artifacts: [run.logs.complete, run.filesystem_effects.artifact],
        diagnostics: run.diagnostics,
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
    const startedAt = Date.now();
    try {
      reviewChangeInputSchema.parse(input);
      signal?.throwIfAborted();
      const proposal = await this.changes.readProposal(input.proposal_ref);
      const attachedRuns = await this.runs.runsForProposal(input.proposal_ref);
      const snapshot = await this.files.snapshot(signal);
      const symbolChanges = await Promise.all(
        proposal.changes.map(async (change) => {
          const contents = await this.changes.proposalFileContents(change);
          return {
            path: change.path,
            ...compareSymbols(change, contents.before, contents.after),
          };
        }),
      );
      const maximumBytes =
        bounded(input.budget?.max_output_tokens, 200, 20_000, 4_000) * 4;
      const diff = Buffer.from(proposal.diff_summary);
      const selectedBytes = utf8PrefixLength(diff, maximumBytes);
      const truncated =
        (proposal.diff_summary_truncated ?? false) ||
        selectedBytes < diff.length;
      return harnessSuccess({
        startedAt,
        revision: revisionVector(snapshot),
        provenance: [provenance("harness", revisionVector(snapshot))],
        artifacts: [
          proposal.diff_artifact,
          ...attachedRuns.flatMap((run) => [
            run.logs.complete,
            run.filesystem_effects.artifact,
          ]),
        ],
        diagnostics: proposal.diagnostics,
        data: {
          proposal_ref: proposal.proposal_ref,
          base_source_revision_id: proposal.base_source_revision_id,
          current_source_revision_id: snapshot.revision.source_revision_id,
          stale:
            proposal.base_source_revision_id !==
            snapshot.revision.source_revision_id,
          files: proposal.changes.map(({ path, old_hash, new_hash }) => ({
            path,
            old_hash,
            new_hash,
          })),
          symbol_changes: symbolChanges,
          generated_files: proposal.changes
            .filter(
              ({ old_hash, new_hash }) =>
                old_hash === null && new_hash !== null,
            )
            .map(({ path }) => path),
          deleted_files: proposal.changes
            .filter(
              ({ old_hash, new_hash }) =>
                old_hash !== null && new_hash === null,
            )
            .map(({ path }) => path),
          formatting: proposal.formatting ?? {
            policy: "none",
            formatted_files: [],
            skipped_files: [],
          },
          attached_runs: attachedRuns.map(publicRun),
          diff: diff.subarray(0, selectedBytes).toString("utf8"),
          diff_bytes: proposal.diff_bytes ?? diff.length,
          diff_artifact_ref: proposal.diff_artifact.ref,
          checks_not_run: checksNotRun(attachedRuns),
        },
        coverage: {
          scope: truncated ? "partial" : "complete",
          truncated,
          analysis: "exact",
          ...(truncated
            ? {
                continuation: String(
                  selectedBytes < diff.length
                    ? selectedBytes
                    : (proposal.diff_summary_bytes ?? diff.length),
                ),
              }
            : {}),
        },
      });
    } catch (error) {
      return toolError(error);
    }
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

function checksNotRun(runs: Array<Awaited<ReturnType<RunService["read"]>>>) {
  const passed = new Set<string>(
    runs
      .filter((run) => run.status === "passed")
      .map((run) => (run.task.kind === "test" ? "tests" : run.task.kind)),
  );
  return ["lint", "typecheck", "tests"].filter((check) => !passed.has(check));
}
