import { createHash } from "node:crypto";
import type { LanguageCapability } from "./capabilities.js";
import type {
  EvidenceCost,
  PlannedCheck as PortPlannedCheck,
} from "./ports.js";
import type {
  ChangeReceiptRef,
  EvidenceRef,
  EnvironmentRevisionId,
  SourceRevisionId,
} from "./result.js";

export const evidencePlannerPolicyVersion = "evidence-planner/v1" as const;

export type RiskKind =
  | "syntax"
  | "local_behavior"
  | "public_contract"
  | "consumer_impact"
  | "data_schema"
  | "dependency_graph"
  | "configuration"
  | "build_integration"
  | "runtime_ui"
  | "acceptance_criterion";

export type EvidenceScope = {
  paths: string[];
  symbols: string[];
  consumers: string[];
};

export type SymbolChange = {
  path: string;
  symbol: string;
  visibility: "private" | "public" | "unknown";
  change: "added" | "body" | "removed" | "signature";
};

export type SemanticDiff = {
  public_api_changed: boolean;
  data_schema_changed: boolean;
  dependency_changed: boolean;
  configuration_changed: boolean;
  ui_changed: boolean;
};

export type RelationSummary = {
  consumers: Array<{
    source_symbol: string;
    target_symbol: string;
    path: string;
  }>;
  bounded: boolean;
};

export type DeclaredTask = {
  task_id: string;
  kind: "build" | "custom" | "lint" | "test" | "typecheck";
  cwd: string;
  supports_file_selection: boolean;
  reliability: "high" | "medium" | "low";
  cost: EvidenceCost;
  covers?: RiskKind[];
};

export type AcceptanceCriterion = {
  criterion_id: string;
  text: string;
  automatable: boolean;
  required_checks: Array<DeclaredTask["kind"] | `task:${string}`>;
};

export type ExistingEvidence = {
  evidence_ref: EvidenceRef;
  check_id: string;
  status: "passed" | "failed" | "unavailable";
  source_revision_id?: SourceRevisionId;
  environment_revision_id: EnvironmentRevisionId;
  blob_hashes?: Record<string, string>;
  paths: string[];
  policy_version: string;
};

export type CapabilitySnapshot = {
  snapshot_id: string;
  languages: LanguageCapability[];
};

export type EvidencePlannerInput = {
  source_revision_id: SourceRevisionId;
  environment_revision_id: EnvironmentRevisionId;
  change_receipts: ChangeReceiptRef[];
  changed_files: string[];
  changed_symbols: SymbolChange[];
  semantic_diff: SemanticDiff;
  bounded_relations: RelationSummary;
  task_catalog: DeclaredTask[];
  acceptance_criteria: AcceptanceCriterion[];
  existing_evidence: ExistingEvidence[];
  capability_snapshot: CapabilitySnapshot;
  capability_snapshot_id: string;
  policy_version: string;
  blob_hashes?: Record<string, string>;
};

export type EvidenceObligation = {
  obligation_id: string;
  risk: RiskKind;
  scope: EvidenceScope;
  requirement: "required" | "recommended";
  status: "satisfied" | "missing" | "unavailable" | "failed";
  satisfied_by: EvidenceRef[];
  candidate_checks: string[];
  rationale_code: string;
};

export type Impact = {
  impact_id: string;
  surface:
    | "private"
    | "public"
    | "data"
    | "configuration"
    | "ui"
    | "dependency";
  scope: EvidenceScope;
};

export type Risk = {
  risk_id: string;
  kind: RiskKind;
  impact_ids: string[];
  rationale_code: string;
};

export type EvidencePlannedCheck = PortPlannedCheck & {
  reliability: DeclaredTask["reliability"];
  selected_paths: string[];
};

export type EvidencePlan = {
  plan_id: string;
  policy_version: string;
  source_revision_id: SourceRevisionId;
  environment_revision_id: EnvironmentRevisionId;
  change_receipts: ChangeReceiptRef[];
  impacts: Impact[];
  risks: Risk[];
  obligations: EvidenceObligation[];
  selected_checks: EvidencePlannedCheck[];
  reused_evidence: EvidenceRef[];
  missing_evidence: EvidenceObligation[];
  estimated_cost: EvidenceCost;
};

type ObligationDraft = Omit<
  EvidenceObligation,
  "candidate_checks" | "satisfied_by" | "status"
>;

export class EvidencePlanner {
  plan(input: EvidencePlannerInput): EvidencePlan {
    assertPlannerInput(input);
    const impacts = deriveImpacts(input);
    const risks = deriveRisks(input, impacts);
    const obligations = materializeObligations(input, impacts, risks);
    const selectedChecks = selectChecks(input.task_catalog, obligations);
    const reusedEvidence = obligations.flatMap(
      (obligation) => obligation.satisfied_by,
    );
    const planContent = {
      policy_version: input.policy_version,
      source_revision_id: input.source_revision_id,
      environment_revision_id: input.environment_revision_id,
      change_receipts: [...input.change_receipts],
      impacts,
      risks,
      obligations,
      selected_checks: selectedChecks,
      reused_evidence: unique(reusedEvidence),
      missing_evidence: obligations.filter(requiredMissing),
      estimated_cost: sumCost(selectedChecks),
    };
    return {
      plan_id: `evidence-plan://${digest(stableJson(planContent))}`,
      ...planContent,
    };
  }
}

function deriveImpacts(input: EvidencePlannerInput) {
  const impacts: Impact[] = [];
  const privateSymbols = input.changed_symbols.filter(
    (symbol) => symbol.visibility !== "public",
  );
  const publicSymbols = input.changed_symbols.filter(
    (symbol) => symbol.visibility !== "private",
  );
  if (privateSymbols.length || input.changed_files.length)
    impacts.push(
      impact(
        "private",
        scope(
          input.changed_files,
          privateSymbols.map((symbol) => symbol.symbol),
        ),
      ),
    );
  if (publicSymbols.length || input.semantic_diff.public_api_changed)
    impacts.push(
      impact(
        "public",
        scope(
          input.changed_files,
          publicSymbols.map((symbol) => symbol.symbol),
          consumerPaths(input),
        ),
      ),
    );
  if (input.semantic_diff.data_schema_changed)
    impacts.push(impact("data", scope(input.changed_files)));
  if (input.semantic_diff.configuration_changed)
    impacts.push(impact("configuration", scope(input.changed_files)));
  if (input.semantic_diff.ui_changed)
    impacts.push(impact("ui", scope(input.changed_files)));
  if (input.semantic_diff.dependency_changed)
    impacts.push(impact("dependency", scope(input.changed_files)));
  return deduplicateImpacts(impacts);
}

function deriveRisks(input: EvidencePlannerInput, impacts: Impact[]) {
  const risks: Risk[] = [];
  if (parseValidationAvailable(input))
    risks.push(risk("syntax", impacts, "LANGUAGE_INTRINSIC_SYNTAX"));
  if (impacts.some(({ surface }) => surface === "private"))
    risks.push(risk("local_behavior", impacts, "PRIVATE_BEHAVIOR_CHANGED"));
  if (impacts.some(({ surface }) => surface === "public")) {
    risks.push(risk("public_contract", impacts, "PUBLIC_SURFACE_CHANGED"));
    risks.push(risk("consumer_impact", impacts, "BOUNDED_CONSUMERS_PRESENT"));
  }
  if (input.semantic_diff.data_schema_changed)
    risks.push(risk("data_schema", impacts, "DATA_SCHEMA_CHANGED"));
  if (input.semantic_diff.dependency_changed)
    risks.push(risk("dependency_graph", impacts, "DEPENDENCY_GRAPH_CHANGED"));
  if (input.semantic_diff.configuration_changed)
    risks.push(risk("configuration", impacts, "CONFIGURATION_CHANGED"));
  if (buildIntegrationChanged(input))
    risks.push(risk("build_integration", impacts, "BUILD_SURFACE_CHANGED"));
  if (input.semantic_diff.ui_changed)
    risks.push(risk("runtime_ui", impacts, "UI_SURFACE_CHANGED"));
  if (input.acceptance_criteria.length)
    risks.push(
      risk("acceptance_criterion", impacts, "DECLARED_ACCEPTANCE_CRITERIA"),
    );
  return risks;
}

function materializeObligations(
  input: EvidencePlannerInput,
  impacts: Impact[],
  risks: Risk[],
) {
  const drafts = [
    ...risks
      .filter((riskValue) => riskValue.kind !== "acceptance_criterion")
      .flatMap((riskValue) => riskObligations(riskValue, impacts, input)),
    ...input.acceptance_criteria.map((criterion) =>
      criterionObligation(criterion, impacts),
    ),
  ];
  return drafts.map((draft) => completeObligation(draft, input));
}

function completeObligation(
  draft: ObligationDraft,
  input: EvidencePlannerInput,
): EvidenceObligation {
  const candidates = candidateChecks(draft, input);
  const evidence = input.existing_evidence.filter((item) =>
    evidenceCovers(item, draft, input),
  );
  const failed = evidence.filter((item) => item.status === "failed");
  const passed = evidence.filter((item) => item.status === "passed");
  const unavailableEvidence = evidence.some(
    (item) => item.status === "unavailable",
  );
  const unavailable =
    explicitUnavailable(draft) ||
    unavailableEvidence ||
    (!candidates.length && !passed.length);
  return {
    ...draft,
    status: failed.length
      ? "failed"
      : passed.length
        ? "satisfied"
        : unavailable
          ? "unavailable"
          : "missing",
    satisfied_by: passed.map((item) => item.evidence_ref),
    candidate_checks: candidates,
  };
}

function candidateChecks(draft: ObligationDraft, input: EvidencePlannerInput) {
  if (explicitUnavailable(draft)) return [];
  const native =
    draft.risk === "syntax" ? nativeParseChecks(input, draft.scope.paths) : [];
  const tasks = input.task_catalog
    .filter((task) => taskCovers(task, draft, input))
    .map((task) => task.task_id);
  return unique([...native, ...tasks]).sort();
}

function selectChecks(
  tasks: DeclaredTask[],
  obligations: EvidenceObligation[],
) {
  const missing = obligations.filter(
    (obligation) =>
      obligation.requirement === "required" && obligation.status === "missing",
  );
  if (!missing.length) return [];
  const candidates = checkCandidates(tasks, missing);
  const selection = minimumCostCover(
    candidates,
    missing.map((obligation) => obligation.obligation_id),
  );
  return selection.map((candidate) => candidate.check);
}

type CheckCandidate = { check: EvidencePlannedCheck; coverage: bigint };

function checkCandidates(
  tasks: DeclaredTask[],
  obligations: EvidenceObligation[],
): CheckCandidate[] {
  const taskMap = new Map(tasks.map((task) => [task.task_id, task]));
  const checkIds = unique(
    obligations.flatMap((obligation) => obligation.candidate_checks),
  );
  return checkIds.flatMap((checkId) => {
    const obligationIds = obligations
      .filter((obligation) => obligation.candidate_checks.includes(checkId))
      .map((obligation) => obligation.obligation_id);
    const task = taskMap.get(checkId) ?? nativeTask(checkId);
    if (!task || task.reliability === "low") return [];
    const selectedPaths = unique(
      obligations
        .filter((obligation) =>
          obligationIds.includes(obligation.obligation_id),
        )
        .flatMap((obligation) => obligation.scope.paths),
    );
    return [
      {
        check: {
          check_id: checkId,
          task_id: task.task_id,
          obligation_ids: obligationIds,
          cost: { ...task.cost },
          reliability: task.reliability,
          selected_paths: task.supports_file_selection ? selectedPaths : [],
        },
        coverage: coverageMask(obligationIds, obligations),
      },
    ];
  });
}

function minimumCostCover(
  candidates: CheckCandidate[],
  obligationIds: string[],
) {
  if (obligationIds.length > 16 || candidates.length > 32)
    return greedyCostCover(candidates, obligationIds.length);
  const target = (1n << BigInt(obligationIds.length)) - 1n;
  const states = new Map<bigint, { indexes: number[]; cost: number }>([
    [0n, { indexes: [], cost: 0 }],
  ]);
  for (const [index, candidate] of candidates.entries())
    updateCoverStates(states, candidate, index);
  const selected = states.get(target)?.indexes ?? [];
  return selected.map((index) => candidates[index]!).sort(selectedCheckOrder);
}

function greedyCostCover(
  candidates: CheckCandidate[],
  obligationCount: number,
) {
  let uncovered = (1n << BigInt(obligationCount)) - 1n;
  const selected: CheckCandidate[] = [];
  const remaining = [...candidates];
  while (uncovered) {
    const candidate = bestGreedyCandidate(remaining, uncovered);
    if (!candidate) break;
    selected.push(candidate);
    uncovered &= ~candidate.coverage;
    remaining.splice(remaining.indexOf(candidate), 1);
  }
  return selected.sort(selectedCheckOrder);
}

function bestGreedyCandidate(candidates: CheckCandidate[], uncovered: bigint) {
  return candidates
    .filter((candidate) => (candidate.coverage & uncovered) !== 0n)
    .sort((left, right) => {
      const leftGain = bitCount(left.coverage & uncovered);
      const rightGain = bitCount(right.coverage & uncovered);
      return (
        normalizedCost(left.check.cost) / leftGain -
          normalizedCost(right.check.cost) / rightGain ||
        selectedCheckOrder(left, right)
      );
    })[0];
}

function bitCount(value: bigint) {
  let count = 0;
  let remaining = value;
  while (remaining) {
    remaining &= remaining - 1n;
    count += 1;
  }
  return count;
}

function updateCoverStates(
  states: Map<bigint, { indexes: number[]; cost: number }>,
  candidate: CheckCandidate,
  index: number,
) {
  for (const [mask, state] of [...states]) {
    const nextMask = mask | candidate.coverage;
    const next = {
      indexes: [...state.indexes, index],
      cost: state.cost + normalizedCost(candidate.check.cost),
    };
    const current = states.get(nextMask);
    if (!current || betterSelection(next, current)) states.set(nextMask, next);
  }
}

function evidenceCovers(
  evidence: ExistingEvidence,
  obligation: ObligationDraft,
  input: EvidencePlannerInput,
) {
  if (!evidenceFresh(evidence, obligation.scope, input)) return false;
  if (!evidenceScopeCovers(evidence, obligation.scope)) return false;
  if (
    evidence.check_id.startsWith("native:parse:") &&
    obligation.risk === "syntax"
  )
    return true;
  return candidateChecks(obligation, input).includes(evidence.check_id);
}

function evidenceScopeCovers(
  evidence: ExistingEvidence,
  scopeValue: EvidenceScope,
) {
  if (!evidence.paths.length) return true;
  return scopeValue.paths.every((path) => evidence.paths.includes(path));
}

function evidenceFresh(
  evidence: ExistingEvidence,
  evidenceScope: EvidenceScope,
  input: EvidencePlannerInput,
) {
  if (evidence.environment_revision_id !== input.environment_revision_id)
    return false;
  if (evidence.policy_version !== input.policy_version) return false;
  if (evidence.source_revision_id === input.source_revision_id) return true;
  if (!evidence.blob_hashes || !input.blob_hashes) return false;
  const relevantPaths = evidenceScope.paths.filter((path) =>
    evidence.paths.includes(path),
  );
  return (
    relevantPaths.length > 0 &&
    relevantPaths.every(
      (path) => evidence.blob_hashes?.[path] === input.blob_hashes?.[path],
    )
  );
}

function riskObligation(riskValue: Risk, impacts: Impact[]): ObligationDraft {
  const related = impacts.filter((impactValue) =>
    riskValue.impact_ids.includes(impactValue.impact_id),
  );
  return {
    obligation_id: obligationId(riskValue.kind, riskValue.risk_id),
    risk: riskValue.kind,
    scope: mergeScopes(related.map((impactValue) => impactValue.scope)),
    requirement: riskValue.kind === "runtime_ui" ? "recommended" : "required",
    rationale_code: riskValue.rationale_code,
  };
}

function riskObligations(
  riskValue: Risk,
  impacts: Impact[],
  input: EvidencePlannerInput,
) {
  if (riskValue.kind !== "syntax") return [riskObligation(riskValue, impacts)];
  return syntaxObligations(riskValue, input);
}

function syntaxObligations(
  riskValue: Risk,
  input: EvidencePlannerInput,
): ObligationDraft[] {
  return syntaxLanguageScopes(input).map(({ languageId, paths }) => ({
    obligation_id: obligationId(
      riskValue.kind,
      `${riskValue.risk_id}:${languageId}:${stableJson(paths)}`,
    ),
    risk: riskValue.kind,
    scope: scope(paths),
    requirement: "required",
    rationale_code: `LANGUAGE_INTRINSIC_SYNTAX:${languageId}`,
  }));
}

function syntaxLanguageScopes(input: EvidencePlannerInput) {
  const languagePaths = new Map<string, Set<string>>();
  for (const language of input.capability_snapshot.languages) {
    if (language.operations.parse_validation.support === "unavailable")
      continue;
    const paths = input.changed_files.filter((path) =>
      language.extensions.includes(fileExtension(path)),
    );
    if (!paths.length) continue;
    const current =
      languagePaths.get(language.language_id) ?? new Set<string>();
    paths.forEach((path) => current.add(path));
    languagePaths.set(language.language_id, current);
  }
  return [...languagePaths].map(([languageId, paths]) => ({
    languageId,
    paths: [...paths].sort(),
  }));
}

function criterionObligation(
  criterion: AcceptanceCriterion,
  impacts: Impact[],
): ObligationDraft {
  return {
    obligation_id: obligationId("acceptance_criterion", criterion.criterion_id),
    risk: "acceptance_criterion",
    scope: mergeScopes(impacts.map((impactValue) => impactValue.scope)),
    requirement: "required",
    rationale_code: criterion.automatable
      ? `ACCEPTANCE:${criterion.criterion_id}`
      : `MANUAL_ACCEPTANCE:${criterion.criterion_id}`,
  };
}

function taskCovers(
  task: DeclaredTask,
  obligation: ObligationDraft,
  input: EvidencePlannerInput,
) {
  if (!scopeMatchesTask(obligation.scope, task.cwd)) return false;
  if (task.covers?.includes(obligation.risk)) return true;
  if (obligation.risk === "acceptance_criterion")
    return acceptanceTaskMatches(task, obligation, input);
  return defaultTaskRisks[task.kind].includes(obligation.risk);
}

function acceptanceTaskMatches(
  task: DeclaredTask,
  obligation: ObligationDraft,
  input: EvidencePlannerInput,
) {
  const criterionId = obligation.rationale_code.split(":", 2)[1];
  const criterion = input.acceptance_criteria.find(
    (value) => value.criterion_id === criterionId,
  );
  if (!criterion) return false;
  return criterion.required_checks.some((check) =>
    check.startsWith("task:")
      ? task.task_id === check.slice(5)
      : task.kind === check,
  );
}

function explicitUnavailable(obligation: ObligationDraft) {
  return obligation.rationale_code.startsWith("MANUAL_ACCEPTANCE:");
}

function nativeParseChecks(
  input: EvidencePlannerInput,
  paths: string[] = input.changed_files,
) {
  const extensions = new Set(paths.map(fileExtension));
  return input.capability_snapshot.languages
    .filter((language) =>
      language.extensions.some((extension) => extensions.has(extension)),
    )
    .filter(
      (language) => language.operations.parse_validation.support === "native",
    )
    .map((language) => `native:parse:${language.language_id}`);
}

function nativeTask(checkId: string): DeclaredTask | undefined {
  if (!checkId.startsWith("native:parse:")) return undefined;
  return {
    task_id: checkId,
    kind: "custom",
    cwd: ".",
    supports_file_selection: true,
    reliability: "high",
    cost: { duration_ms: 25, compute_units: 1 },
    covers: ["syntax"],
  };
}

function impact(
  surface: Impact["surface"],
  impactScope: EvidenceScope,
): Impact {
  return {
    impact_id: `impact://${digest(stableJson([surface, impactScope])).slice(0, 20)}`,
    surface,
    scope: impactScope,
  };
}

function risk(kind: RiskKind, impacts: Impact[], rationaleCode: string): Risk {
  const related = impacts.filter((impactValue) =>
    riskMatchesSurface(kind, impactValue.surface),
  );
  const impactIds = (related.length ? related : impacts).map(
    (impactValue) => impactValue.impact_id,
  );
  return {
    risk_id: `risk://${digest(stableJson([kind, impactIds])).slice(0, 20)}`,
    kind,
    impact_ids: impactIds,
    rationale_code: rationaleCode,
  };
}

function riskMatchesSurface(kind: RiskKind, surface: Impact["surface"]) {
  const mapping: Partial<Record<RiskKind, Impact["surface"][]>> = {
    local_behavior: ["private"],
    public_contract: ["public"],
    consumer_impact: ["public"],
    data_schema: ["data"],
    dependency_graph: ["dependency"],
    configuration: ["configuration"],
    runtime_ui: ["ui"],
  };
  return mapping[kind]?.includes(surface) ?? true;
}

function parseValidationAvailable(input: EvidencePlannerInput) {
  const extensions = new Set(input.changed_files.map(fileExtension));
  return input.capability_snapshot.languages.some(
    (language) =>
      language.extensions.some((extension) => extensions.has(extension)) &&
      language.operations.parse_validation.support !== "unavailable",
  );
}

function buildIntegrationChanged(input: EvidencePlannerInput) {
  return input.changed_files.some((path) =>
    /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|vite\.config\.|next\.config\.|webpack\.config\.)/u.test(
      path,
    ),
  );
}

function consumerPaths(input: EvidencePlannerInput) {
  return unique(
    input.bounded_relations.consumers.map((consumer) => consumer.path),
  );
}

function scope(
  paths: string[],
  symbols: string[] = [],
  consumers: string[] = [],
): EvidenceScope {
  return {
    paths: unique(paths).sort(),
    symbols: unique(symbols).sort(),
    consumers: unique(consumers).sort(),
  };
}

function mergeScopes(scopes: EvidenceScope[]) {
  return scope(
    scopes.flatMap((value) => value.paths),
    scopes.flatMap((value) => value.symbols),
    scopes.flatMap((value) => value.consumers),
  );
}

function deduplicateImpacts(impacts: Impact[]) {
  return [
    ...new Map(
      impacts.map((impactValue) => [impactValue.impact_id, impactValue]),
    ).values(),
  ];
}

function scopeMatchesTask(taskScope: EvidenceScope, cwd: string) {
  if (cwd === ".") return true;
  return taskScope.paths.some(
    (path) => path === cwd || path.startsWith(`${cwd}/`),
  );
}

function coverageMask(covered: string[], obligations: EvidenceObligation[]) {
  return covered.reduce((mask, obligationId) => {
    const index = obligations.findIndex(
      (obligation) => obligation.obligation_id === obligationId,
    );
    return index < 0 ? mask : mask | (1n << BigInt(index));
  }, 0n);
}

function betterSelection(
  left: { indexes: number[]; cost: number },
  right: { indexes: number[]; cost: number },
) {
  return (
    left.cost < right.cost ||
    (left.cost === right.cost && left.indexes.length < right.indexes.length)
  );
}

function selectedCheckOrder(left: CheckCandidate, right: CheckCandidate) {
  return (
    normalizedCost(left.check.cost) - normalizedCost(right.check.cost) ||
    left.check.check_id.localeCompare(right.check.check_id)
  );
}

function normalizedCost(cost: EvidenceCost) {
  return cost.duration_ms + cost.compute_units * 100;
}

function sumCost(checks: EvidencePlannedCheck[]): EvidenceCost {
  return checks.reduce(
    (total, check) => ({
      duration_ms: total.duration_ms + check.cost.duration_ms,
      compute_units: total.compute_units + check.cost.compute_units,
    }),
    { duration_ms: 0, compute_units: 0 },
  );
}

function requiredMissing(obligation: EvidenceObligation) {
  return (
    obligation.requirement === "required" && obligation.status !== "satisfied"
  );
}

function obligationId(riskKind: RiskKind, identity: string) {
  return `obligation://${digest(`${riskKind}\0${identity}`).slice(0, 24)}`;
}

function assertPlannerInput(input: EvidencePlannerInput) {
  if (input.capability_snapshot.snapshot_id !== input.capability_snapshot_id)
    throw new Error("CAPABILITY_SNAPSHOT_MISMATCH");
  if (!input.source_revision_id) throw new Error("SOURCE_REVISION_REQUIRED");
  if (!input.environment_revision_id)
    throw new Error("ENVIRONMENT_REVISION_REQUIRED");
}

function fileExtension(path: string) {
  return path.toLowerCase().match(/\.[^.]+$/u)?.[0] ?? "";
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

const defaultTaskRisks: Record<DeclaredTask["kind"], RiskKind[]> = {
  build: [
    "build_integration",
    "configuration",
    "consumer_impact",
    "dependency_graph",
    "public_contract",
  ],
  custom: [
    "acceptance_criterion",
    "configuration",
    "data_schema",
    "dependency_graph",
  ],
  lint: ["configuration", "syntax"],
  test: [
    "acceptance_criterion",
    "consumer_impact",
    "local_behavior",
    "runtime_ui",
  ],
  typecheck: [
    "build_integration",
    "consumer_impact",
    "public_contract",
    "syntax",
  ],
};
