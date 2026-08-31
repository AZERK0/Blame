import { createHash } from "node:crypto";
import type {
  EnvironmentRevisionId,
  RevisionPair,
  SourceRevisionId,
} from "./result.js";

export type DependencyState = {
  status: "unknown" | "restoring" | "probing" | "ready" | "failed";
  manifest_ref?: string;
  failure_signature?: string;
};

export type PreviewReadiness =
  | "stopped"
  | "browser_ready"
  | "container_ready"
  | "application_ready"
  | "failed";

export type PreviewState = {
  readiness: PreviewReadiness;
  revisions?: RevisionPair;
  diagnostic?: string;
};

export type WorkingSetEntry = {
  path: string;
  symbols: string[];
  views: string[];
};

export type HarnessStateSnapshot = RevisionPair & {
  sequence: number;
  dependency: DependencyState;
  preview: PreviewState;
  working_set: WorkingSetEntry[];
};

export type EnvironmentRevisionInput = {
  dependency_digest: string;
  package_manager: string;
  resolved_version: string;
  platform: string;
  architecture: string;
  runtime_target: string;
  build_environment_digest: string;
  dependency_volume_digest: string;
  execution_profile: string;
};

export interface StateAuthority {
  current(): HarnessStateSnapshot;
  setSourceRevision(sourceRevisionId: SourceRevisionId): HarnessStateSnapshot;
  setEnvironment(input: EnvironmentRevisionInput): HarnessStateSnapshot;
  setDependency(state: DependencyState): HarnessStateSnapshot;
  setPreview(state: PreviewState): HarnessStateSnapshot;
  setWorkingSet(entries: WorkingSetEntry[]): HarnessStateSnapshot;
}

export class InMemoryStateAuthority implements StateAuthority {
  private snapshotValue: HarnessStateSnapshot;

  constructor(input: {
    source_revision_id: SourceRevisionId;
    environment: EnvironmentRevisionInput;
  }) {
    this.snapshotValue = {
      source_revision_id: input.source_revision_id,
      environment_revision_id: environmentRevisionId(input.environment),
      sequence: 0,
      dependency: { status: "unknown" },
      preview: { readiness: "stopped" },
      working_set: [],
    };
  }

  current() {
    return cloneSnapshot(this.snapshotValue);
  }

  setSourceRevision(sourceRevisionId: SourceRevisionId) {
    if (sourceRevisionId === this.snapshotValue.source_revision_id)
      return this.current();
    this.snapshotValue = {
      ...this.snapshotValue,
      source_revision_id: sourceRevisionId,
      sequence: this.snapshotValue.sequence + 1,
      preview: stalePreview(this.snapshotValue.preview),
      working_set: [],
    };
    return this.current();
  }

  setEnvironment(input: EnvironmentRevisionInput) {
    const environmentRevisionIdValue = environmentRevisionId(input);
    if (
      environmentRevisionIdValue ===
      this.snapshotValue.environment_revision_id
    )
      return this.current();
    this.snapshotValue = {
      ...this.snapshotValue,
      environment_revision_id: environmentRevisionIdValue,
      sequence: this.snapshotValue.sequence + 1,
      dependency: { status: "unknown" },
      preview: stalePreview(this.snapshotValue.preview),
    };
    return this.current();
  }

  setDependency(state: DependencyState) {
    this.snapshotValue = nextSnapshot(this.snapshotValue, {
      dependency: cloneDependency(state),
    });
    return this.current();
  }

  setPreview(state: PreviewState) {
    assertPreviewRevision(state, this.snapshotValue);
    this.snapshotValue = nextSnapshot(this.snapshotValue, {
      preview: clonePreview(state),
    });
    return this.current();
  }

  setWorkingSet(entries: WorkingSetEntry[]) {
    this.snapshotValue = nextSnapshot(this.snapshotValue, {
      working_set: entries.map(cloneWorkingSetEntry),
    });
    return this.current();
  }
}

export function environmentRevisionId(
  input: EnvironmentRevisionInput,
): EnvironmentRevisionId {
  return `env_${createHash("sha256").update(stableJson(input)).digest("hex")}`;
}

export function sameRevisionPair(left: RevisionPair, right: RevisionPair) {
  return (
    left.source_revision_id === right.source_revision_id &&
    left.environment_revision_id === right.environment_revision_id
  );
}

function nextSnapshot(
  current: HarnessStateSnapshot,
  change: Partial<HarnessStateSnapshot>,
): HarnessStateSnapshot {
  return { ...current, ...change, sequence: current.sequence + 1 };
}

function stalePreview(preview: PreviewState): PreviewState {
  if (preview.readiness === "stopped") return preview;
  return { readiness: "container_ready" };
}

function assertPreviewRevision(
  preview: PreviewState,
  current: RevisionPair,
) {
  if (preview.readiness !== "application_ready") return;
  if (!preview.revisions || !sameRevisionPair(preview.revisions, current))
    throw new Error("PREVIEW_REVISION_MISMATCH");
}

function cloneSnapshot(snapshot: HarnessStateSnapshot): HarnessStateSnapshot {
  return {
    ...snapshot,
    dependency: cloneDependency(snapshot.dependency),
    preview: clonePreview(snapshot.preview),
    working_set: snapshot.working_set.map(cloneWorkingSetEntry),
  };
}

function cloneDependency(state: DependencyState): DependencyState {
  return { ...state };
}

function clonePreview(state: PreviewState): PreviewState {
  return {
    ...state,
    ...(state.revisions ? { revisions: { ...state.revisions } } : {}),
  };
}

function cloneWorkingSetEntry(entry: WorkingSetEntry): WorkingSetEntry {
  return {
    path: entry.path,
    symbols: [...entry.symbols],
    views: [...entry.views],
  };
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
