import {
  ATTR_BLAME_OPERATION_NAME,
  ATTR_ERROR_TYPE,
  getBlameTelemetry,
  type BlameSpan,
  type Context,
} from "@blame/telemetry";

type WorkspaceStepCategory =
  | "compose"
  | "environment"
  | "git"
  | "preview"
  | "setup"
  | "worktree";

export type WorkspaceTelemetryStep = {
  category: WorkspaceStepCategory;
  name: string;
};

const fallbackWorkspaceStep: WorkspaceTelemetryStep = {
  category: "setup",
  name: "setup.other",
};

const exactWorkspaceSteps: Record<string, WorkspaceTelemetryStep> = {
  "branch exists check": step("git", "git.branch_check"),
  "compose allocate ports": step("compose", "compose.allocate_ports"),
  "compose completed dependencies": step(
    "compose",
    "compose.completed_dependencies",
  ),
  "compose config": step("compose", "compose.config"),
  "compose file write": step("compose", "compose.file_write"),
  "compose inject host mounts": step("compose", "compose.inject_host_mounts"),
  "compose log stream": step("compose", "compose.log_stream"),
  "compose normalize": step("compose", "compose.normalize"),
  "compose prepare": step("compose", "compose.prepare"),
  "compose repair": step("compose", "compose.repair"),
  "compose runtime services": step("compose", "compose.runtime_services"),
  "compose setup services": step("compose", "compose.setup_services"),
  "compose up": step("compose", "compose.up"),
  "compose volumes": step("compose", "compose.volumes"),
  "dependency hash": step("compose", "compose.dependency_hash"),
  "env file scan": step("environment", "environment.file_scan"),
  "env sync": step("environment", "environment.sync"),
  "git repository check": step("git", "git.repository_check"),
  "git repository ensure": step("git", "git.repository_ensure"),
  "git safe directory": step("git", "git.safe_directory"),
  "git worktree add existing branch": step(
    "git",
    "git.worktree_add_existing_branch",
  ),
  "git worktree add new branch": step("git", "git.worktree_add_new_branch"),
  "host dependencies": step("setup", "setup.host_dependencies"),
  "initialization directory mkdir": step(
    "setup",
    "setup.initialization_directory",
  ),
  "initialization files": step("setup", "setup.initialization_files"),
  "preview env host mounts": step(
    "environment",
    "environment.preview_host_mounts",
  ),
  "preview environment sync": step("environment", "environment.preview_sync"),
  "preview response wait": step("preview", "preview.response_wait"),
  "preview service restart": step("preview", "preview.service_restart"),
  "preview url resolve": step("preview", "preview.url_resolve"),
  "setup process spawn": step("setup", "setup.process_spawn"),
  "setup process runtime": step("setup", "setup.process_runtime"),
  "setup script chmod": step("setup", "setup.script_permissions"),
  "setup script write": step("setup", "setup.script_write"),
  "worktree parent mkdir": step("worktree", "worktree.parent_directory"),
  "worktree path exists check": step("worktree", "worktree.path_check"),
  "worktree registered check": step("worktree", "worktree.registered_check"),
};

const dynamicWorkspaceSteps: Array<{
  prefix: string;
  telemetryStep: WorkspaceTelemetryStep;
}> = [
  {
    prefix: "compose dependency service ",
    telemetryStep: step("compose", "compose.dependency_service"),
  },
  {
    prefix: "compose setup service ",
    telemetryStep: step("compose", "compose.setup_service"),
  },
  {
    prefix: "compose volume create ",
    telemetryStep: step("compose", "compose.volume_create"),
  },
  {
    prefix: "dependency cache check ",
    telemetryStep: step("compose", "compose.dependency_cache_check"),
  },
  {
    prefix: "dependency cache mark ",
    telemetryStep: step("compose", "compose.dependency_cache_mark"),
  },
  {
    prefix: "dependency init cache check ",
    telemetryStep: step("compose", "compose.dependency_init_cache_check"),
  },
];

export function workspaceTelemetryStep(label: string) {
  const exactStep = exactWorkspaceSteps[label];
  if (exactStep) return exactStep;
  return (
    dynamicWorkspaceSteps.find(({ prefix }) => label.startsWith(prefix))
      ?.telemetryStep ?? fallbackWorkspaceStep
  );
}

export async function traceWorkspaceStep<T>(
  label: string,
  action: () => Promise<T> | T,
) {
  const telemetry = getBlameTelemetry();
  const span = startWorkspaceStep(label);
  return telemetry.withinSpan(span, () => runWorkspaceStep(span, action));
}

export function startWorkspaceStep(label: string, parent?: Context) {
  const telemetryStep = workspaceTelemetryStep(label);
  const operationName = `blame.workspace.${telemetryStep.name}`;
  return getBlameTelemetry().startSpan(operationName, {
    attributes: workspaceStepAttributes(operationName, telemetryStep),
    parent,
  });
}

function step(
  category: WorkspaceStepCategory,
  name: string,
): WorkspaceTelemetryStep {
  return { category, name };
}

function workspaceStepAttributes(
  operationName: string,
  telemetryStep: WorkspaceTelemetryStep,
) {
  return {
    [ATTR_BLAME_OPERATION_NAME]: operationName,
    "blame.workspace.step.category": telemetryStep.category,
    "blame.workspace.step.name": telemetryStep.name,
  };
}

async function runWorkspaceStep<T>(
  span: BlameSpan,
  action: () => Promise<T> | T,
) {
  try {
    const result = await action();
    span.end("succeeded");
    return result;
  } catch (error) {
    span.setAttributes({ [ATTR_ERROR_TYPE]: workspaceErrorType(error) });
    span.end("failed");
    throw error;
  }
}

function workspaceErrorType(error: unknown) {
  const name = error instanceof Error ? error.name : "Error";
  return /^(?:AbortError|Error|RangeError|TimeoutError|TypeError)$/.test(name)
    ? name
    : "Error";
}
