import type { PreviewLifecycleState } from "@blame/preview-contract";
import type { PreviewDevtoolsTarget } from "../preview-browser/preview-browser-manager.ts";
import {
  previewDevtoolsEnabledCapabilities,
  previewDevtoolsMcpVersion,
  previewDevtoolsUnavailableCapabilities,
} from "../preview-browser/preview-devtools-config.ts";

export type PreviewHarnessStatus =
  | "failed"
  | "ready"
  | "starting"
  | "stopped"
  | "unavailable";

export type PreviewHarnessState = PreviewDevtoolsTarget & {
  lifecycle?: PreviewLifecycleState;
  message: string;
  mcp: {
    enabledCapabilities: readonly string[];
    pageScoped: true;
    unavailableCapabilities: ReadonlyArray<{
      capability: string;
      reason: string;
    }>;
    version: string;
  };
  reason: string;
  readiness: {
    browser_ready: boolean;
    container_ready: boolean;
    application_ready: boolean;
  };
  status: PreviewHarnessStatus;
};

const previewStatusMessages = {
  ready: {
    message: "The preview application is ready.",
    reason: "PREVIEW_APPLICATION_READY",
  },
  starting: {
    message: "The preview is currently starting.",
    reason: "PREVIEW_STARTING",
  },
  stopped: {
    message: "The preview is not running.",
    reason: "PREVIEW_STOPPED",
  },
  unavailable: {
    message: "The preview runtime is ready, but its browser view is not open.",
    reason: "PREVIEW_BROWSER_NOT_OPEN",
  },
} as const;

export function previewHarnessState(
  browser: PreviewDevtoolsTarget,
  lifecycle?: PreviewLifecycleState,
): PreviewHarnessState {
  const status = previewHarnessStatus(browser, lifecycle);
  const readiness = previewReadiness(browser, lifecycle);
  return {
    ...browser,
    available: status === "ready",
    ...(lifecycle ? { lifecycle } : {}),
    mcp: {
      enabledCapabilities: previewDevtoolsEnabledCapabilities,
      pageScoped: true,
      unavailableCapabilities: previewDevtoolsUnavailableCapabilities,
      version: previewDevtoolsMcpVersion,
    },
    ...previewHarnessStatusMessage(status, browser, lifecycle),
    readiness,
    status,
  };
}

export async function resolvePreviewHarnessState(
  inspect: () => Promise<PreviewHarnessState>,
  waitFor: "none" | "ready" | undefined,
  waitForRefresh: () => Promise<void>,
) {
  let state = await inspect();
  if (waitFor !== "ready" || state.status !== "starting") return state;
  while (state.status === "starting") {
    await waitForRefresh();
    state = await inspect();
  }
  return state;
}

function previewHarnessStatus(
  browser: PreviewDevtoolsTarget,
  lifecycle: PreviewLifecycleState | undefined,
): PreviewHarnessStatus {
  if (browser.application?.status === "failed") return "failed";
  if (lifecycle?.status === "error") return "failed";
  if (lifecycle?.status === "idle") return "stopped";
  if (lifecycle?.status === "pending") {
    if (previewStopping(lifecycle.phase)) return "stopped";
    return browser.error ? "failed" : "starting";
  }
  if (browser.error) return "failed";
  if (lifecycle?.status === "ready") {
    if (browser.available && browser.application?.status === "ready")
      return "ready";
    if (browser.available) return "starting";
    return browser.loading ? "starting" : "unavailable";
  }
  if (browser.available && browser.application?.status === "ready")
    return "ready";
  if (browser.available) return "starting";
  if (browser.loading || browser.currentUrl) return "starting";
  return "stopped";
}

function previewHarnessStatusMessage(
  status: PreviewHarnessStatus,
  browser: PreviewDevtoolsTarget,
  lifecycle: PreviewLifecycleState | undefined,
) {
  if (status === "failed") {
    const message =
      browser.application?.diagnostic ??
      browser.error ??
      lifecycle?.failure?.message;
    return {
      message: message ?? "The preview failed.",
      reason: "PREVIEW_FAILED",
    };
  }
  return previewStatusMessages[status];
}

function previewReadiness(
  browser: PreviewDevtoolsTarget,
  lifecycle: PreviewLifecycleState | undefined,
) {
  const browserReady = browser.available;
  const containerReady = lifecycle
    ? lifecycle.status === "ready"
    : browserReady;
  return {
    browser_ready: browserReady,
    container_ready: containerReady,
    application_ready:
      browserReady && containerReady && browser.application?.status === "ready",
  };
}

function previewStopping(phase: PreviewLifecycleState["phase"]) {
  return ["stopping", "suspending", "destroying"].includes(phase);
}
