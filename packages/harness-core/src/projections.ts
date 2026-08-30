import { createHash } from "node:crypto";
import type { SourceRevisionId } from "./result.js";

export type ProjectionIdentity = {
  projection_id: string;
  kind: "task_briefing" | "capsule" | "working_set" | "frontend_view" | "cache";
  source_revision_id: SourceRevisionId;
  epoch: string;
  produced_at: string;
  freshness: "fresh" | "stale";
};

export type Projection<T> = ProjectionIdentity & {
  dependencies: Record<string, string>;
  value: T;
};

export type ProjectionRecipe<T> = {
  kind: ProjectionIdentity["kind"];
  source_revision_id: SourceRevisionId;
  epoch: string;
  dependencies: Record<string, string>;
  build(): Promise<T> | T;
};

export class ProjectionEngine {
  private readonly projections = new Map<string, Projection<unknown>>();

  async build<T>(recipe: ProjectionRecipe<T>): Promise<Projection<T>> {
    const value = await recipe.build();
    const projection = materializeProjection(recipe, value);
    this.projections.set(projection.projection_id, projection);
    return cloneProjection(projection);
  }

  get<T>(projectionId: string): Projection<T> | undefined {
    const projection = this.projections.get(projectionId);
    return projection
      ? cloneProjection(projection as Projection<T>)
      : undefined;
  }

  invalidate(changedDependencies: Record<string, string>) {
    for (const [reference, projection] of this.projections) {
      if (!dependencyChanged(projection.dependencies, changedDependencies))
        continue;
      this.projections.set(reference, { ...projection, freshness: "stale" });
    }
  }

  remove(projectionId: string) {
    return this.projections.delete(projectionId);
  }
}

function materializeProjection<T>(
  recipe: ProjectionRecipe<T>,
  value: T,
): Projection<T> {
  const producedAt = new Date().toISOString();
  const identity = stableJson({
    kind: recipe.kind,
    source_revision_id: recipe.source_revision_id,
    epoch: recipe.epoch,
    dependencies: recipe.dependencies,
    value,
  });
  return {
    projection_id: `projection://${digest(identity)}`,
    kind: recipe.kind,
    source_revision_id: recipe.source_revision_id,
    epoch: recipe.epoch,
    produced_at: producedAt,
    freshness: "fresh",
    dependencies: { ...recipe.dependencies },
    value,
  };
}

function dependencyChanged(
  current: Record<string, string>,
  changed: Record<string, string>,
) {
  return Object.entries(changed).some(
    ([key, value]) => current[key] !== undefined && current[key] !== value,
  );
}

function cloneProjection<T>(projection: Projection<T>): Projection<T> {
  return { ...projection, dependencies: { ...projection.dependencies } };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
  return `{${entries.join(",")}}`;
}
