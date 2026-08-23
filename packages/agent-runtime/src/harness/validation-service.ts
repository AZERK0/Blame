import { ArtifactStore } from "./artifact-store.js";
import type {
  CommitReceipt,
  StoredChangeProposal,
  StoredRun,
  ValidateChangeInput,
} from "./schemas.js";

type RequiredCheck = NonNullable<
  ValidateChangeInput["criteria"]
>[number]["requires"][number];

type CheckEvidence = {
  check: RequiredCheck;
  status: "failed" | "missing" | "passed" | "unsupported";
  run_ref?: string;
  detail?: string;
};

export class ValidationService {
  private readonly artifacts: ArtifactStore;

  constructor(artifacts: ArtifactStore) {
    this.artifacts = artifacts;
  }

  async validate(input: {
    criteria?: ValidateChangeInput["criteria"];
    proposal: StoredChangeProposal;
    receipt: CommitReceipt;
    runs: StoredRun[];
  }) {
    const checks = checkEvidence(input.proposal, input.runs);
    const criteria = (input.criteria ?? []).map((criterion) =>
      criterionEvidence(criterion, checks),
    );
    const bundle = {
      proposal_ref: input.proposal.proposal_ref,
      source_revision_id: input.receipt.source_revision.source_revision_id,
      checks,
      criteria,
      summary: validationSummary(checks, criteria),
    };
    const artifact = await this.artifacts.put(
      JSON.stringify(bundle, null, 2),
      "application/vnd.blame.evidence-bundle+json",
      "1.0",
      "agent_redacted",
      { source_revision_id: input.receipt.source_revision.source_revision_id },
    );
    return { bundle, artifact };
  }
}

function checkEvidence(
  proposal: StoredChangeProposal,
  runs: StoredRun[],
): CheckEvidence[] {
  return [
    parseEvidence(proposal),
    ...(["lint", "typecheck", "test", "build"] as const).map((kind) =>
      runEvidence(kind, latestRun(runs, kind)),
    ),
  ];
}

function parseEvidence(proposal: StoredChangeProposal): CheckEvidence {
  const supported = proposal.diagnostics.filter(
    (diagnostic) => diagnostic.analysis === "parser",
  );
  if (!supported.length) return { check: "parse", status: "unsupported" };
  const regressions = supported.filter(
    (diagnostic) => diagnostic.after_errors > diagnostic.before_errors,
  );
  return regressions.length
    ? {
        check: "parse",
        status: "failed",
        detail: `${regressions.length} file(s) gained syntax errors.`,
      }
    : { check: "parse", status: "passed" };
}

function runEvidence(
  check: Exclude<RequiredCheck, "parse">,
  run?: StoredRun,
): CheckEvidence {
  if (!run) return { check, status: "missing" };
  return {
    check,
    status: run.status === "passed" ? "passed" : "failed",
    run_ref: run.run_ref,
    ...(run.status === "passed" ? {} : { detail: run.status }),
  };
}

function latestRun(runs: StoredRun[], kind: StoredRun["task"]["kind"]) {
  return runs
    .filter((run) => run.task.kind === kind)
    .sort((left, right) =>
      right.completed_at.localeCompare(left.completed_at),
    )[0];
}

function criterionEvidence(
  criterion: NonNullable<ValidateChangeInput["criteria"]>[number],
  checks: CheckEvidence[],
) {
  const evidence = criterion.requires.map(
    (required) => checks.find((check) => check.check === required)!,
  );
  const status: "failed" | "unverified" | "verified" = evidence.some(
    (item) => item.status === "failed",
  )
    ? "failed"
    : evidence.every((item) => item.status === "passed")
      ? "verified"
      : "unverified";
  return {
    id: criterion.id,
    text: criterion.text,
    requires: criterion.requires,
    status,
    evidence: evidence.map((item) => ({
      check: item.check,
      status: item.status,
      ...(item.run_ref ? { run_ref: item.run_ref } : {}),
    })),
  };
}

function validationSummary(
  checks: CheckEvidence[],
  criteria: Array<{ status: "failed" | "unverified" | "verified" }>,
) {
  return {
    checks: statusCounts(checks.map((check) => check.status)),
    criteria: statusCounts(criteria.map((criterion) => criterion.status)),
    complete:
      criteria.length > 0 &&
      criteria.every((criterion) => criterion.status === "verified"),
  };
}

function statusCounts(values: string[]) {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}
