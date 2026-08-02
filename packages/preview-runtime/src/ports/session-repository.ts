import type { PreviewSessionRecord } from "../domain/preview-session.js";
import type { RuntimeHandle } from "./preview-runtime-driver.js";

export type PreviewOperationRecord = {
  sessionId: string;
  operationId: string;
  commandType: string;
  status: "running" | "succeeded" | "failed";
  resultRevision?: number;
  errorCode?: string;
  createdAt: string;
  completedAt?: string;
};

export interface SessionRepository {
  create(record: PreviewSessionRecord): Promise<void>;
  get(sessionId: string): Promise<PreviewSessionRecord | undefined>;
  save(record: PreviewSessionRecord, expectedRevision: number): Promise<void>;
  listReconcileCandidates(now: string, limit: number): Promise<PreviewSessionRecord[]>;
  getRuntimeHandle(sessionId: string): Promise<RuntimeHandle | undefined>;
  setRuntimeHandle(
    sessionId: string,
    handle: RuntimeHandle | undefined,
    fencingToken?: number,
  ): Promise<void>;
  getOperation(sessionId: string, operationId: string): Promise<PreviewOperationRecord | undefined>;
  saveOperation(operation: PreviewOperationRecord): Promise<void>;
}

export class OptimisticRevisionError extends Error {
  constructor() {
    super("Preview session was changed by another operation.");
    this.name = "OptimisticRevisionError";
  }
}
