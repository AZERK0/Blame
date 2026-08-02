import type {
  PreviewExecutionPlan,
  RuntimeProtocolHandshake,
  RuntimeSelection,
  SourceArtifact,
} from "@blame/preview-runtime";

export const runnerProtocolVersion = 1;

export type RunnerUploadTarget = {
  expiresAt: string;
  headers: Record<string, string>;
  url: string;
};

export type RunnerRequest = (
  | { operation: "handshake" }
  | { operation: "resume-host"; sessionId: string; generation: number }
  | {
      operation: "prepare-engine";
      engine: "vercel-compose" | "vercel-process";
      plan: PreviewExecutionPlan;
      browserBindingUrls?: Record<string, string>;
      capabilityPublicKey?: string;
      sessionId?: string;
      generation?: number;
    }
  | { operation: "start-services"; selection: RuntimeSelection }
  | { operation: "stop-services" }
  | { operation: "inspect"; probeServices?: boolean }
  | { operation: "endpoints" }
  | { operation: "logs"; cursor?: string; serviceId?: string }
  | { operation: "source-import"; source: SourceArtifact }
  | {
      operation: "source-export-prepare";
      revision: string;
      artifactId: string;
    }
  | {
      operation: "source-export-upload";
      artifactId: string;
      upload: RunnerUploadTarget;
    }
  | { operation: "source-export-ack"; revision: string }
  | {
      operation: "exec";
      command: string;
      args: string[];
      cwd: string;
      environment?: Record<string, string>;
      timeoutMs?: number;
    }
) & { fencingToken: number };

export type RunnerSuccess<T = unknown> = { ok: true; result: T };
export type RunnerFailure = {
  ok: false;
  error: { code: string; message: string };
};
export type RunnerResponse<T = unknown> = RunnerSuccess<T> | RunnerFailure;

export function runnerHandshake(input: {
  runnerVersion: string;
  imageDigest: string;
  capabilities: RuntimeProtocolHandshake["capabilities"];
}): RuntimeProtocolHandshake {
  return {
    protocolVersion: runnerProtocolVersion,
    runnerVersion: input.runnerVersion,
    imageDigest: input.imageDigest,
    capabilities: input.capabilities,
  };
}
