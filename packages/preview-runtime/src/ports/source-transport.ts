import type { DurableDeltaReceipt, SourceArtifact } from "./preview-runtime-driver.js";

export type WorkspaceRef = {
  id: string;
  mode: "local-container" | "cloud-mirror";
  localPath: string;
  remotePath?: "/workspace";
  previewSessionId?: string;
};

export interface SourceTransport {
  createInitialArtifact(input: {
    sessionId: string;
    workspace: WorkspaceRef;
    sourceRevision: string;
  }): Promise<SourceArtifact>;
  applyDelta(input: {
    sessionId: string;
    workspace: WorkspaceRef;
    delta: DurableDeltaReceipt;
  }): Promise<{ appliedRevision: string; finalHash: string }>;
  discardDelta(artifactId: string, confirmationId: string): Promise<void>;
}
