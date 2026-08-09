import type {
  PreviewLogEvent,
  PreviewSessionBackend,
  PreviewSessionCommand,
  PreviewSessionEvent,
  PreviewSessionView,
} from "@blame/preview-runtime";
import { parsePreviewManifest } from "@blame/agent-runtime";

export type CloudApiConnection = { token: string; url: string };
type CloudPreviewClientOptions = { packaged?: boolean };

export type CloudManagedPreviewCreateInput = {
  userStoryId: string;
  profile: "vercel-compose";
  previewManifest: unknown;
  cloudUploadConsentAt: string;
  operationId: string;
  sourceRevision?: string;
  sourceMetadata?: {
    sourceRevision: string;
    sanitizedTreeHash: string;
    lockfileHash: string;
    workspaceHash: string;
  };
  resourceSize?: { vcpus: number; memoryGb: number };
};
export class CloudPreviewClient implements PreviewSessionBackend<CloudManagedPreviewCreateInput> {
  private readonly connection: CloudApiConnection;

  constructor(
    connection: CloudApiConnection,
    options: CloudPreviewClientOptions = {},
  ) {
    if (!allowedCloudApiBaseUrl(connection.url, options.packaged ?? false))
      throw new Error("Cloud API connection is invalid");
    if (!connection.token || connection.token.length > 16_384)
      throw new Error("Cloud API token is invalid");
    this.connection = connection;
  }

  create(input: CloudManagedPreviewCreateInput) {
    return this.request<PreviewSessionView>("/preview-sessions", {
      method: "POST",
      headers: { "idempotency-key": input.operationId },
      body: {
        userStoryId: input.userStoryId,
        profile: input.profile,
        previewManifest: parsePreviewManifest(input.previewManifest),
        cloudUploadConsentAt: input.cloudUploadConsentAt,
        operationId: input.operationId,
        sourceRevision: input.sourceRevision,
        sourceMetadata: input.sourceMetadata,
        resourceSize: input.resourceSize,
      },
    });
  }

  command(
    sessionId: string,
    command: PreviewSessionCommand,
    operationId: string,
  ) {
    return this.request<PreviewSessionView>(
      `/preview-sessions/${encoded(sessionId)}/actions`,
      {
        method: "POST",
        headers: { "idempotency-key": operationId },
        body: { command, operationId },
      },
    );
  }

  get(sessionId: string) {
    return this.request<PreviewSessionView>(
      `/preview-sessions/${encoded(sessionId)}`,
    );
  }

  async *events(
    sessionId: string,
    cursor?: string,
  ): AsyncIterable<PreviewSessionEvent> {
    let nextCursor = cursor;
    while (true) {
      const query = nextCursor
        ? `?cursor=${encodeURIComponent(nextCursor)}`
        : "";
      const response = await this.fetch(
        `/preview-sessions/${encoded(sessionId)}/events${query}`,
        {
          headers: { Accept: "text/event-stream" },
        },
      );
      if (!response.ok || !response.body) throw await cloudError(response);
      for await (const event of parseEventStream(response.body)) {
        const value = JSON.parse(event.data) as PreviewSessionEvent;
        nextCursor = event.id || value.cursor;
        yield value;
      }
    }
  }

  async *logs(
    sessionId: string,
    cursor?: string,
  ): AsyncIterable<PreviewLogEvent> {
    let nextCursor = cursor;
    while (true) {
      const query = nextCursor
        ? `?cursor=${encodeURIComponent(nextCursor)}`
        : "";
      const response = await this.fetch(
        `/preview-sessions/${encoded(sessionId)}/logs${query}`,
        { headers: { Accept: "text/event-stream" } },
      );
      if (!response.ok || !response.body) throw await cloudError(response);
      for await (const event of parseEventStream(response.body)) {
        const value = JSON.parse(event.data) as PreviewLogEvent;
        nextCursor = event.id || String(value.sequence);
        yield value;
      }
    }
  }

  bridgeGrant(sessionId: string) {
    return this.request<DesktopBridgeGrant>(
      `/preview-sessions/${encoded(sessionId)}/bridge-grant`,
      {
        method: "POST",
        body: {},
      },
    );
  }

  accessTicket(sessionId: string, routeId?: string) {
    return this.request<
      import("./external-preview-launcher").ExternalPreviewTicket
    >(`/preview-sessions/${encoded(sessionId)}/access-ticket`, {
      method: "POST",
      body: { routeId },
    });
  }

  prepareSourceUpload(
    sessionId: string,
    artifact: {
      sha256: string;
      size: number;
      sourceRevision: string;
      sanitizedTreeHash?: string;
      lockfileHash?: string;
      workspaceHash?: string;
      mode?: "full" | "delta";
    },
  ) {
    return this.request<UploadTarget>(
      `/preview-sessions/${encoded(sessionId)}/source/import`,
      {
        method: "POST",
        body: {
          action: "prepare",
          sha256: artifact.sha256,
          size: artifact.size,
          sourceRevision: artifact.sourceRevision,
          sanitizedTreeHash: artifact.sanitizedTreeHash,
          lockfileHash: artifact.lockfileHash,
          workspaceHash: artifact.workspaceHash,
          mode: artifact.mode,
        },
      },
    );
  }

  negotiateSource(
    sessionId: string,
    metadata: {
      sourceRevision: string;
      sanitizedTreeHash: string;
      lockfileHash: string;
      workspaceHash: string;
    },
  ) {
    return this.request<{
      baseline?: UploadTarget["baseline"];
      unchanged: boolean;
      session: PreviewSessionView;
    }>(`/preview-sessions/${encoded(sessionId)}/source/import`, {
      method: "POST",
      body: { action: "negotiate", ...metadata },
    });
  }

  applySourceUpload(
    sessionId: string,
    artifactId: string,
    baselineId?: string,
  ) {
    return this.request<PreviewSessionView>(
      `/preview-sessions/${encoded(sessionId)}/source/import`,
      {
        method: "POST",
        body: { action: "apply", artifactId, baselineId },
      },
    );
  }

  exportSourceDelta(sessionId: string) {
    return this.request<DeltaDownload>(
      `/preview-sessions/${encoded(sessionId)}/source/export`,
      {
        method: "POST",
        body: {},
      },
    );
  }

  private async request<T>(path: string, input: RequestInput = {}) {
    const response = await this.fetch(path, {
      method: input.method,
      headers: input.headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    if (!response.ok) throw await cloudError(response);
    return response.json() as Promise<T>;
  }

  private fetch(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.connection.token}`);
    if (init.body !== undefined)
      headers.set("Content-Type", "application/json");
    return fetch(
      new URL(apiPath(path), normalizedBaseUrl(this.connection.url)),
      {
        ...init,
        headers,
        redirect: "error",
      },
    );
  }
}
export function allowedCloudApiBaseUrl(value: string, packaged: boolean) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash || url.search) return false;
    const apiPath = url.pathname.replace(/\/$/, "");
    if (url.origin === "https://api.blame.so" && apiPath === "/api/v1") {
      return true;
    }
    return (
      !packaged &&
      ["http:", "https:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      apiPath === "/api/v1"
    );
  } catch {
    return false;
  }
}

export type DesktopBridgeGrant = {
  sessionId: string;
  endpointRevision: number;
  integratedPreviewRequired: boolean;
  primaryRouteId: string;
  routes: Array<{
    routeId: string;
    serviceId: string;
    endpointId: string;
    logicalHost: "localhost";
    logicalPort: number;
    protocol: "http" | "https" | "ws" | "wss";
    providerUrl: string;
    capability: string;
    capabilityExpiresAt: string;
  }>;
};

export type UploadTarget = {
  artifactId: string;
  expiresAt: string;
  headers: Record<string, string>;
  url: string;
  baseline?: {
    id: string;
    fingerprint: string;
    status: "building" | "ready" | "failed" | "expired" | "deleting";
    baseRevision: string;
    match?: "exact" | "cache";
    providerSnapshotId?: string;
  };
};

export type DeltaDownload = {
  artifactId: string;
  sha256: string;
  size: number;
  baseHash: string | null;
  finalHash: string | null;
  generation: number | null;
  revision: string | null;
  discardConfirmationId: string;
  url: string;
};

type RequestInput = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

function normalizedBaseUrl(value: string) {
  const url = new URL(value);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function apiPath(value: string) {
  return value.replace(/^\//, "");
}

function encoded(value: string) {
  if (!isCloudPreviewSessionId(value))
    throw new Error("Preview session ID is invalid");
  return encodeURIComponent(value);
}

export function isCloudPreviewSessionId(value: unknown): value is string {
  return typeof value === "string" && /^preview_[a-f0-9]{32}$/.test(value);
}

async function cloudError(response: Response) {
  const message = await response.text().catch(() => "");
  return new Error(
    `Cloud preview request failed (${response.status}): ${message.slice(0, 500)}`,
  );
}

async function* parseEventStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary).replaceAll("\r", "");
        buffer = buffer.slice(boundary + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        const id = block
          .split("\n")
          .find((line) => line.startsWith("id:"))
          ?.slice(3)
          .trim();
        if (data) yield { data, id };
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
