import {
  DependencyEnvironmentService,
  probeDependencyEnvironment,
} from "./dependency-environment.js";
import { environmentSpec } from "./environment-service.js";
import { readTaskCatalog } from "./task-catalog.js";
import { WorkspaceFiles, type WorkspaceSnapshot } from "./workspace-files.js";

export type WorkspaceRevisionState = {
  source_revision_id: string;
  environment_revision_id: string;
  dependencies_ready: boolean;
};

export class WorkspaceStateAuthority {
  private readonly files: WorkspaceFiles;

  constructor(files: WorkspaceFiles) {
    this.files = files;
  }

  async current(snapshot?: WorkspaceSnapshot): Promise<WorkspaceRevisionState> {
    const resolved = await this.resolve(snapshot);
    return {
      source_revision_id: resolved.snapshot.revision.source_revision_id,
      environment_revision_id: resolved.environment.environment_revision_id,
      dependencies_ready: resolved.probe.status === "passed",
    };
  }

  async environment(snapshot?: WorkspaceSnapshot) {
    return (await this.resolve(snapshot)).environment;
  }

  private async resolve(snapshotInput?: WorkspaceSnapshot) {
    const snapshot = snapshotInput ?? (await this.files.snapshot());
    const catalog = await readTaskCatalog(this.files.root, snapshot.files);
    const dependencyTask = catalog.find((task) => task.kind === "dependencies");
    const persistent = dependencyTask
      ? await new DependencyEnvironmentService(this.files.root).inspect(
          this.files,
          snapshot,
          dependencyTask,
        )
      : undefined;
    const probe = persistent
      ? persistent.integrity_probe
      : await probeDependencyEnvironment(this.files.root, snapshot.files);
    const environment =
      persistent?.spec ??
      (await environmentSpec(this.files, snapshot, {
        packageManager: dependencyTask?.package_manager,
        resolvedPackageManagerVersion:
          dependencyTask?.package_manager_version ?? "unversioned",
      }));
    return { environment, probe, snapshot };
  }
}

export async function currentWorkspaceRevisionState(
  workspaceRoot: string,
): Promise<WorkspaceRevisionState> {
  const files = new WorkspaceFiles(workspaceRoot);
  return new WorkspaceStateAuthority(files).current();
}
