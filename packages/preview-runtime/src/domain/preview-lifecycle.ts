import type { PreviewLifecycleState } from "@blame/preview-contract";
import type { PreviewSessionView } from "./preview-session.js";

export type {
  PreviewLifecyclePhase,
  PreviewLifecycleState,
  PreviewLifecycleStatus,
} from "@blame/preview-contract";

export function previewSessionLifecycle(
  session: PreviewSessionView,
): PreviewLifecycleState {
  const since = session.stateChangedAt;
  const failure = session.failure
    ? {
        message: session.failure.message,
        retryable: session.failure.retryable,
      }
    : undefined;
  if (
    failure ||
    session.state.host === "failed" ||
    session.state.engine === "failed" ||
    session.state.agent === "failed" ||
    session.state.sync === "failed" ||
    session.state.sync === "conflict"
  ) {
    return {
      phase: "failed",
      status: "error",
      since,
      failure: failure ?? {
        message:
          session.state.sync === "conflict"
            ? "The preview workspace is in conflict."
            : "The preview runtime failed.",
      },
    };
  }
  if (session.state.host === "destroyed")
    return { phase: "destroyed", status: "idle", since };
  if (session.desired.host === "destroyed")
    return { phase: "destroying", status: "pending", since };
  if (session.state.host === "destroying")
    return { phase: "destroying", status: "pending", since };
  if (session.desired.host === "active" && session.state.host === "suspended")
    return { phase: "resuming", status: "pending", since };
  if (session.state.host === "provisioning")
    return { phase: "provisioning", status: "pending", since };
  if (session.state.host === "resuming")
    return { phase: "resuming", status: "pending", since };
  if (
    session.desired.host === "suspended" &&
    session.state.host !== "suspended"
  )
    return { phase: "suspending", status: "pending", since };
  if (session.state.host === "suspending")
    return { phase: "suspending", status: "pending", since };
  if (session.state.host === "suspended")
    return { phase: "suspended", status: "idle", since };
  if (["importing", "exporting", "applying"].includes(session.state.sync))
    return { phase: "synchronizing", status: "pending", since };
  if (
    session.desired.services === "stopped" &&
    (session.state.engine !== "stopped" || session.state.preview !== "closed")
  )
    return { phase: "stopping", status: "pending", since };
  if (
    session.state.engine === "stopping" ||
    session.state.preview === "closing"
  )
    return { phase: "stopping", status: "pending", since };
  if (session.state.engine === "preparing")
    return { phase: "preparing", status: "pending", since };
  if (session.state.engine === "starting")
    return { phase: "starting", status: "pending", since };
  if (session.state.preview === "opening")
    return { phase: "loading", status: "pending", since };
  if (
    session.state.host === "running" &&
    session.state.engine === "running" &&
    session.state.preview === "ready" &&
    session.endpointMap
  ) {
    return { phase: "ready", status: "ready", since };
  }
  if (session.desired.services === "running")
    return { phase: "starting", status: "pending", since };
  return { phase: "idle", status: "idle", since };
}
