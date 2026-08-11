import type {
  PreviewSessionCommand,
  PreviewSessionRecord,
} from "../domain/preview-session.js";
import { PreviewRuntimeError } from "../domain/preview-errors.js";

export function applyPreviewCommand(
  record: PreviewSessionRecord,
  command: PreviewSessionCommand,
): PreviewSessionRecord {
  if (record.state.host === "destroyed" && command.type !== "destroy-host") {
    throw new PreviewRuntimeError({
      code: "PROVISION_FAILED",
      message: "A destroyed preview session cannot be resumed.",
      retryable: false,
    });
  }
  const next = structuredClone(record);
  next.lastActivityAt = new Date().toISOString();
  next.stateChangedAt = next.lastActivityAt;
  switch (command.type) {
    case "start-services":
      next.desired.host = "active";
      next.desired.services = "running";
      next.desired.preview = "open";
      next.selection = {
        configurationId: command.configurationId,
        serviceIds: command.serviceIds
          ? [...new Set(command.serviceIds)]
          : undefined,
        ...(command.primaryRoute
          ? { primaryRoute: { ...command.primaryRoute } }
          : {}),
      };
      break;
    case "stop-services":
      next.desired.services = "stopped";
      next.desired.preview = "closed";
      break;
    case "start-agent":
      next.desired.host = "active";
      next.desired.agent = "running";
      break;
    case "stop-agent":
      next.desired.agent = "idle";
      break;
    case "suspend-host":
      next.desired.host = "suspended";
      next.desired.services = "stopped";
      next.desired.preview = "closed";
      next.desired.agent = "idle";
      break;
    case "resume-host":
      next.desired.host = "active";
      break;
    case "report-sync-conflict":
      next.desired.host = "suspended";
      next.desired.services = "stopped";
      next.desired.preview = "closed";
      next.desired.agent = "idle";
      next.state.sync = "conflict";
      break;
    case "destroy-host":
      if (pendingSync(next) && !command.discardPendingDelta) {
        throw new PreviewRuntimeError({
          code: "SYNC_CONFLICT",
          message:
            "The durable remote delta must be applied or explicitly discarded before destruction.",
          retryable: false,
        });
      }
      if (command.discardPendingDelta) next.state.sync = "discarded";
      next.desired.host = "destroyed";
      next.desired.services = "stopped";
      next.desired.preview = "closed";
      next.desired.agent = "idle";
      break;
    case "ack-local-sync":
      if (next.lastExportedJournalRevision !== command.deltaRevision) {
        throw new PreviewRuntimeError({
          code: "SYNC_CONFLICT",
          message:
            "The acknowledged delta does not match the latest durable export.",
          retryable: false,
        });
      }
      next.lastAppliedLocalRevision = command.deltaRevision;
      if (command.workspaceHash) next.workspaceHash = command.workspaceHash;
      next.state.sync = "applying";
      break;
  }
  return next;
}

function pendingSync(record: PreviewSessionRecord) {
  return (
    Boolean(record.pendingDeltaArtifactId) ||
    [
      "exporting",
      "pending_local_sync",
      "applying",
      "conflict",
      "failed",
    ].includes(record.state.sync)
  );
}
