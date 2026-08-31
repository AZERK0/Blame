import {
  DependencyEnvironmentService,
  probeDependencyEnvironment,
} from "./dependency-environment.js";
import { environmentSpec } from "./environment-service.js";
import { readTaskCatalog } from "./task-catalog.js";
import { WorkspaceFiles } from "./workspace-files.js";

export type WorkspaceRevisionState = {
  source_revision_id: string;
  environment_revision_id: string;
  dependencies_ready: boolean;
};

export async function currentWorkspaceRevisionState(
  workspaceRoot: string,
): Promise<WorkspaceRevisionState> {
  const files = new WorkspaceFiles(workspaceRoot);
  const snapshot = await files.snapshot();
  const catalog = await readTaskCatalog(workspaceRoot, snapshot.files);
  const dependencyTask = catalog.find((task) => task.kind === "dependencies");
  const persistent = dependencyTask
    ? await new DependencyEnvironmentService(workspaceRoot).inspect(
        files,
        snapshot,
        dependencyTask,
      )
    : undefined;
  const probe = persistent
    ? persistent.integrity_probe
    : await probeDependencyEnvironment(workspaceRoot, snapshot.files);
  const environment =
    persistent?.spec ??
    (await environmentSpec(files, snapshot, {
      packageManager: dependencyTask?.package_manager,
      resolvedPackageManagerVersion:
        dependencyTask?.package_manager_version ?? "unversioned",
    }));
  return {
    source_revision_id: snapshot.revision.source_revision_id,
    environment_revision_id: environment.environment_revision_id,
    dependencies_ready: probe.status === "passed",
  };
}
