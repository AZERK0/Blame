import type { ChangeService } from "./change-service.js";
import { harnessSuccess, provenance, type ArtifactRef } from "./protocol.js";
import type { RelationService } from "./relation-service.js";
import { publicRun, type RunService } from "./run-service.js";
import type {
  ReviewChangeInput,
  StoredChangeProposal,
  StoredRun,
  ValidateChangeInput,
} from "./schemas.js";
import {
  reviewChangeInputSchema,
  validateChangeInputSchema,
} from "./schemas.js";
import {
  approximateTokens,
  bounded,
  compareSymbols,
  revisionVector,
  semanticDiffNames,
  semanticSymbolDiff,
  staleRevision,
  toolError,
} from "./semantic-workspace-support.js";
import type { ValidationService } from "./validation-service.js";
import type { WorkspaceFiles, WorkspaceSnapshot } from "./workspace-files.js";

type ChangeAnalysis = {
  path: string;
  symbols: ReturnType<typeof compareSymbols>;
  semantic: ReturnType<typeof semanticSymbolDiff>;
};

type ReviewContext = {
  proposal: StoredChangeProposal;
  receipt: Awaited<ReturnType<ChangeService["readReceipt"]>>;
  runs: StoredRun[];
  snapshot: WorkspaceSnapshot;
  analyses: ChangeAnalysis[];
};

type Impact = Awaited<ReturnType<RelationService["impact"]>>;

export class ChangeReviewService {
  private readonly changes: ChangeService;
  private readonly files: WorkspaceFiles;
  private readonly relations: RelationService;
  private readonly runs: RunService;
  private readonly validation: ValidationService;

  constructor(
    changes: ChangeService,
    files: WorkspaceFiles,
    relations: RelationService,
    runs: RunService,
    validation: ValidationService,
  ) {
    this.changes = changes;
    this.files = files;
    this.relations = relations;
    this.runs = runs;
    this.validation = validation;
  }

  async reviewChange(input: ReviewChangeInput, signal?: AbortSignal) {
    const startedAt = Date.now();
    try {
      const parsedInput = reviewChangeInputSchema.parse(input);
      signal?.throwIfAborted();
      const context = await this.reviewContext(
        parsedInput.proposal_ref,
        signal,
      );
      const output = await this.reviewOutput(parsedInput, context, signal);
      return harnessSuccess({
        startedAt,
        revision: revisionVector(context.snapshot),
        provenance: [provenance("harness", revisionVector(context.snapshot))],
        artifacts: reviewArtifacts(context),
        diagnostics: context.proposal.diagnostics,
        data: output.data,
        coverage: output.coverage,
      });
    } catch (error) {
      return toolError(error);
    }
  }

  async validateChange(input: ValidateChangeInput, signal?: AbortSignal) {
    const startedAt = Date.now();
    try {
      validateChangeInputSchema.parse(input);
      const context = await this.validationContext(input, signal);
      const result = await this.validation.validate(context);
      const data = boundedEvidence(
        result.bundle,
        input.budget?.max_output_tokens ?? 2_500,
      );
      return validationSuccess(
        startedAt,
        context.snapshot,
        result.artifact,
        data,
      );
    } catch (error) {
      return toolError(error);
    }
  }

  private async reviewContext(proposalRef?: string, signal?: AbortSignal) {
    const snapshot = await this.files.snapshot(signal);
    const proposal = isExactProposalReference(proposalRef)
      ? await this.changes.readProposal(proposalRef)
      : await this.changes.proposeCurrentDiff(snapshot, signal);
    const [receipt, proposalRuns] = await Promise.all([
      this.changes.readReceipt(proposal.proposal_ref),
      this.runs.runsForProposal(proposal.proposal_ref),
    ]);
    const revisionRuns = receipt
      ? await this.runs.runsForRevision(
          receipt.source_revision.source_revision_id,
        )
      : [];
    const [runs, analyses] = [
      uniqueRuns([...proposalRuns, ...revisionRuns]),
      await analyzeChanges(this.changes, proposal),
    ];
    return { proposal, receipt, runs, snapshot, analyses };
  }

  private async reviewOutput(
    input: ReviewChangeInput,
    context: ReviewContext,
    signal?: AbortSignal,
  ) {
    const includes = new Set(input.include ?? ["semantic_diff"]);
    const tokenBudget = bounded(
      input.budget?.max_output_tokens,
      200,
      20_000,
      4_000,
    );
    const impact = includes.has("impact")
      ? await this.changeImpact(context, tokenBudget, signal)
      : undefined;
    const selection = selectDiff(context.proposal, tokenBudget, impact);
    return {
      data: reviewData(context, includes, impact, selection),
      coverage: reviewCoverage(context.proposal, selection, includes.size > 0),
    };
  }

  private changeImpact(
    context: ReviewContext,
    tokenBudget: number,
    signal?: AbortSignal,
  ) {
    return this.relations.impact({
      changedPaths: context.proposal.changes.map((change) => change.path),
      names: context.analyses.flatMap((analysis) =>
        semanticDiffNames(analysis.semantic),
      ),
      snapshot: context.snapshot,
      signal,
      tokenBudget: Math.min(2_000, Math.floor(tokenBudget / 3)),
    });
  }

  private async validationContext(
    input: ValidateChangeInput,
    signal?: AbortSignal,
  ) {
    const proposal = await this.changes.readProposal(input.proposal_ref);
    const receipt = await this.changes.readReceipt(input.proposal_ref);
    if (!receipt)
      throw new Error(
        "Precondition failed: proposal must be committed before validation.",
      );
    const snapshot = await this.exactSnapshot(
      receipt.source_revision.source_revision_id,
      signal,
    );
    const runs = await this.runs.runsForRevision(
      snapshot.revision.source_revision_id,
    );
    return { criteria: input.criteria, proposal, receipt, runs, snapshot };
  }

  private async exactSnapshot(expected: string, signal?: AbortSignal) {
    const snapshot = await this.files.snapshot(signal);
    if (snapshot.revision.source_revision_id !== expected)
      throw staleRevision(snapshot.revision.source_revision_id);
    return snapshot;
  }
}

function isExactProposalReference(value?: string): value is string {
  return Boolean(value?.startsWith("change-proposal://"));
}

async function analyzeChanges(
  changes: ChangeService,
  proposal: StoredChangeProposal,
) {
  return Promise.all(
    proposal.changes.map(async (change) => {
      const contents = await changes.proposalFileContents(change);
      return {
        path: change.path,
        symbols: compareSymbols(change, contents.before, contents.after),
        semantic: semanticSymbolDiff(
          change.path,
          contents.before,
          contents.after,
        ),
      };
    }),
  );
}

function selectDiff(
  proposal: StoredChangeProposal,
  tokenBudget: number,
  impact?: Impact,
) {
  const maximumBytes =
    Math.max(800, tokenBudget - (impact ? approximateTokens(impact) : 0)) * 4;
  const diff = Buffer.from(proposal.diff_summary);
  const selectedBytes = utf8PrefixLength(diff, maximumBytes);
  return {
    diff,
    selectedBytes,
    truncated:
      (proposal.diff_summary_truncated ?? false) ||
      selectedBytes < diff.length ||
      Boolean(impact?.truncated),
  };
}

function reviewData(
  context: ReviewContext,
  includes: Set<string>,
  impact: Impact | undefined,
  selection: ReturnType<typeof selectDiff>,
) {
  return {
    ...reviewIdentity(context),
    ...reviewFileChanges(context.proposal),
    symbol_changes: context.analyses.map(({ path, symbols }) => ({
      path,
      ...symbols,
    })),
    ...(includes.has("semantic_diff")
      ? { semantic_diff: semanticDiff(context.analyses) }
      : {}),
    ...(impact ? { impact } : {}),
    formatting: context.proposal.formatting ?? defaultFormatting,
    attached_runs: context.runs.map(publicRun),
    diff: selection.diff.subarray(0, selection.selectedBytes).toString("utf8"),
    diff_bytes: context.proposal.diff_bytes ?? selection.diff.length,
    diff_artifact_ref: context.proposal.diff_artifact.ref,
    checks_not_run: checksNotRun(context.runs),
  };
}

function reviewIdentity(context: ReviewContext) {
  const current = context.snapshot.revision.source_revision_id;
  const expected = context.receipt
    ? context.receipt.source_revision.source_revision_id
    : context.proposal.base_source_revision_id;
  return {
    proposal_ref: context.proposal.proposal_ref,
    base_source_revision_id: context.proposal.base_source_revision_id,
    current_source_revision_id: current,
    stale: expected !== current,
  };
}

function reviewFileChanges(proposal: StoredChangeProposal) {
  return {
    files: proposal.changes.map(({ path, old_hash, new_hash }) => ({
      path,
      old_hash,
      new_hash,
    })),
    generated_files: proposal.changes
      .filter(
        ({ old_hash, new_hash }) => old_hash === null && new_hash !== null,
      )
      .map(({ path }) => path),
    deleted_files: proposal.changes
      .filter(
        ({ old_hash, new_hash }) => old_hash !== null && new_hash === null,
      )
      .map(({ path }) => path),
  };
}

function semanticDiff(analyses: ChangeAnalysis[]) {
  return analyses.map(({ path, semantic }) => ({ path, ...semantic }));
}

function reviewArtifacts(context: ReviewContext) {
  return [
    context.proposal.diff_artifact,
    ...context.runs.flatMap((run) => [
      run.logs.complete,
      run.filesystem_effects.artifact,
    ]),
  ];
}

function reviewCoverage(
  proposal: StoredChangeProposal,
  selection: ReturnType<typeof selectDiff>,
  includesHeuristicAnalysis: boolean,
) {
  const continuation =
    selection.selectedBytes < selection.diff.length
      ? selection.selectedBytes
      : (proposal.diff_summary_bytes ?? selection.diff.length);
  return {
    scope: selection.truncated ? ("partial" as const) : ("complete" as const),
    truncated: selection.truncated,
    analysis: includesHeuristicAnalysis
      ? ("heuristic" as const)
      : ("exact" as const),
    ...(selection.truncated ? { continuation: String(continuation) } : {}),
  };
}

function validationSuccess<T extends { criteria: unknown[] }>(
  startedAt: number,
  snapshot: WorkspaceSnapshot,
  artifact: ArtifactRef,
  data: { value: T; truncated: boolean },
) {
  return harnessSuccess({
    startedAt,
    revision: revisionVector(snapshot),
    provenance: [provenance("harness", revisionVector(snapshot))],
    data: { ...data.value, evidence_ref: artifact.ref },
    artifacts: [artifact],
    coverage: {
      scope: data.truncated ? "partial" : "complete",
      truncated: data.truncated,
      analysis: "observed_subset",
    },
  });
}

function checksNotRun(runs: StoredRun[]) {
  const passed = new Set<string>(
    runs
      .filter((run) => run.status === "passed")
      .map((run) => (run.task.kind === "test" ? "tests" : run.task.kind)),
  );
  return ["lint", "typecheck", "tests"].filter((check) => !passed.has(check));
}

function uniqueRuns(runs: StoredRun[]) {
  return [...new Map(runs.map((run) => [run.run_ref, run])).values()];
}

function boundedEvidence<T extends { criteria: unknown[] }>(
  bundle: T,
  tokenBudget: number,
) {
  const value = { ...bundle, criteria: [...bundle.criteria] } as T;
  while (value.criteria.length && approximateTokens(value) > tokenBudget)
    value.criteria.pop();
  return { value, truncated: value.criteria.length < bundle.criteria.length };
}

function utf8PrefixLength(content: Buffer, maximumBytes: number) {
  if (content.byteLength <= maximumBytes) return content.byteLength;
  let end = maximumBytes;
  while (end > 0 && (content[end]! & 0xc0) === 0x80) end -= 1;
  return end;
}

const defaultFormatting: NonNullable<StoredChangeProposal["formatting"]> = {
  policy: "none",
  formatted_files: [],
  skipped_files: [],
};
