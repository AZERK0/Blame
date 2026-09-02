import { currentWorkspaceRevisionState } from "@blame/agent-runtime";
import type { PreviewLifecycleState } from "@blame/preview-contract";
import { previewSessionLifecycle } from "@blame/preview-runtime";
import {
  inspectPreviewDevtoolsTarget,
  type PreviewDevtoolsTarget,
} from "../preview-browser-ipc.ts";
import {
  previewHarnessState,
  resolvePreviewHarnessState,
  shouldStartStoppedLocalPreview,
  type PreviewHarnessStatus,
} from "./preview-harness-state.ts";
export type {
  PreviewHarnessState,
  PreviewHarnessStatus,
} from "./preview-harness-state.ts";
import {
  controlProjectPreview,
  projectPreviewLifecycleState,
} from "../workspace-ipc.ts";
import type { PreviewService } from "./preview-service.ts";

export type PreviewHarnessInput = {
  scope?: string;
  signal?: AbortSignal;
  storyId?: string;
  waitFor?: "none" | "ready";
  workspaceMode?: "local-container" | "cloud-mirror";
  worktree?: string;
};

type PreviewHarnessDependencies = {
  browserTarget: (input: {
    scope?: string;
  }) => Promise<PreviewDevtoolsTarget> | PreviewDevtoolsTarget;
  localLifecycle: typeof projectPreviewLifecycleState;
  refreshIntervalMs: number;
  readinessTimeoutMs: number;
  startLocal: (worktree: string) => Promise<unknown>;
};

const defaultDependencies: PreviewHarnessDependencies = {
  browserTarget: inspectPreviewDevtoolsTarget,
  localLifecycle: projectPreviewLifecycleState,
  refreshIntervalMs: 500,
  readinessTimeoutMs: 30_000,
  startLocal: (worktree) =>
    controlProjectPreview({ action: "start", worktree }),
};

export class PreviewHarnessService {
  private readonly previews: PreviewService;
  private readonly dependencies: PreviewHarnessDependencies;

  constructor(previews: PreviewService, dependencies = defaultDependencies) {
    this.previews = previews;
    this.dependencies = dependencies;
  }

  async inspect(input: PreviewHarnessInput) {
    const [browser, lifecycle, revisions] = await Promise.all([
      Promise.resolve(this.dependencies.browserTarget({ scope: input.scope })),
      this.lifecycle(input),
      this.revisions(input),
    ]);
    if (browser.error)
      return previewHarnessState(browser, undefined, revisions);
    return previewHarnessState(browser, lifecycle, revisions);
  }

  async target(input: PreviewHarnessInput) {
    const initial = await this.inspect(input);
    let started = false;
    try {
      started = await this.startStoppedLocalPreview(input, initial.status);
    } catch (error) {
      return failedPreviewStart(initial, error);
    }
    if (!started && initial.status !== "starting") return initial;
    return resolvePreviewHarnessState(
      () => this.inspect(input),
      input.waitFor,
      () => abortableDelay(this.dependencies.refreshIntervalMs, input.signal),
      started ? undefined : initial,
      { timeoutMs: this.dependencies.readinessTimeoutMs },
    );
  }

  private async startStoppedLocalPreview(
    input: PreviewHarnessInput,
    status: PreviewHarnessStatus,
  ) {
    if (!input.worktree) return false;
    if (!shouldStartStoppedLocalPreview({ ...input, status })) return false;
    await this.dependencies.startLocal(input.worktree);
    return true;
  }

  private async lifecycle(input: PreviewHarnessInput) {
    try {
      if (input.workspaceMode === "cloud-mirror") {
        return this.managedLifecycle(input.storyId);
      }
      if (!input.worktree) return undefined;
      return await this.dependencies.localLifecycle(input.worktree);
    } catch (error) {
      return failedLifecycle(error);
    }
  }

  private async managedLifecycle(storyId: string | undefined) {
    if (!storyId) return idleLifecycle();
    const result = await this.previews.findForUserStory(
      storyId,
      "vercel-compose",
    );
    return result.session
      ? previewSessionLifecycle(result.session)
      : idleLifecycle();
  }

  private async revisions(input: PreviewHarnessInput) {
    if (!input.worktree) return undefined;
    return currentWorkspaceRevisionState(input.worktree).catch(() => undefined);
  }
}

function failedPreviewStart(
  state: Awaited<ReturnType<PreviewHarnessService["inspect"]>>,
  error: unknown,
) {
  const diagnostic = error instanceof Error ? error.message : String(error);
  return {
    ...state,
    available: false,
    message: diagnostic.slice(0, 2_000),
    reason: "PREVIEW_START_FAILED",
    status: "failed" as const,
  };
}

function idleLifecycle(): PreviewLifecycleState {
  return { phase: "idle", since: new Date().toISOString(), status: "idle" };
}

function failedLifecycle(error: unknown): PreviewLifecycleState {
  return {
    failure: {
      message: error instanceof Error ? error.message : String(error),
    },
    phase: "failed",
    since: new Date().toISOString(),
    status: "error",
  };
}

function abortableDelay(ms: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", abort, { once: true });
    function finish() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Preview wait aborted"));
    }
  });
}
