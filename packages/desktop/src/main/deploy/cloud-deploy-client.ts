import type {
  DeploymentManifest,
  DeploymentSnapshot,
  ProjectDeployment,
} from "@blame/deploy-contract";
import { allowedCloudApiBaseUrl } from "../preview-runtime/cloud-preview-client.ts";

export type CloudDeployConnection = { token: string; url: string };

type UploadTarget = {
  artifactId: string;
  expiresAt: string;
  headers: Record<string, string>;
  url: string;
};

export class CloudDeployClient {
  constructor(
    private readonly connection: CloudDeployConnection,
    packaged = false,
  ) {
    if (!allowedCloudApiBaseUrl(connection.url, packaged)) {
      throw new Error("Cloud API connection is invalid");
    }
    if (!connection.token || connection.token.length > 16_384) {
      throw new Error("Cloud API token is invalid");
    }
  }

  create(input: {
    projectId: string;
    targetId: string;
    operationId: string;
    snapshot: DeploymentSnapshot;
    manifest: DeploymentManifest;
    archive: { sha256: string; size: number };
  }) {
    return this.request<{
      deployment: ProjectDeployment;
      upload: UploadTarget | null;
    }>(`/projects/${encoded(input.projectId)}/deployments`, {
      method: "POST",
      headers: { "idempotency-key": input.operationId },
      body: {
        targetId: input.targetId,
        operationId: input.operationId,
        snapshot: input.snapshot,
        manifest: input.manifest,
        archive: input.archive,
      },
    });
  }

  complete(projectId: string, deploymentId: string, artifactId: string) {
    return this.request<{ deployment: ProjectDeployment }>(
      `/projects/${encoded(projectId)}/deployments/${encoded(deploymentId)}/source/complete`,
      {
        method: "POST",
        body: { artifactId },
      },
    );
  }

  private async request<T>(
    path: string,
    input: {
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    } = {},
  ) {
    const headers = new Headers(input.headers);
    headers.set("Authorization", `Bearer ${this.connection.token}`);
    if (input.body !== undefined)
      headers.set("Content-Type", "application/json");
    const response = await fetch(
      new URL(path.replace(/^\//, ""), normalizedBaseUrl(this.connection.url)),
      {
        method: input.method,
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        redirect: "error",
      },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(safeCloudMessage(response.status, body));
    }
    return response.json() as Promise<T>;
  }
}

export async function uploadDeploySource(
  target: UploadTarget,
  content: Uint8Array,
) {
  if (Date.parse(target.expiresAt) <= Date.now()) {
    throw new Error("Deployment upload URL expired");
  }
  const response = await fetch(validatedUploadUrl(target.url), {
    method: "PUT",
    headers: target.headers,
    body: Buffer.from(content),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Deployment source upload failed");
}

function normalizedBaseUrl(value: string) {
  const url = new URL(value);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function encoded(value: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error("Cloud resource ID is invalid");
  }
  return encodeURIComponent(value);
}

function validatedUploadUrl(value: string) {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("Deployment artifact URL is invalid");
  }
  return url;
}

function safeCloudMessage(status: number, body: string) {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const message = parsed.error?.message ?? parsed.message;
    if (typeof message === "string" && message.length <= 500) return message;
  } catch {}
  return `Deployment request failed (${status})`;
}
