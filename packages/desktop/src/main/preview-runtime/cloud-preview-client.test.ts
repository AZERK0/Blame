import assert from "node:assert/strict";
import test from "node:test";
import {
  CloudPreviewRequestError,
  CloudPreviewClient,
  isBaselineSnapshotUnavailable,
  isCloudPreviewSessionId,
} from "./cloud-preview-client.ts";

test("restricts packaged cloud credentials to the official API", () => {
  assert.doesNotThrow(
    () =>
      new CloudPreviewClient(
        { token: "a".repeat(32), url: "https://api.blame.so/api/v1" },
        { packaged: true },
      ),
  );
  assert.throws(
    () =>
      new CloudPreviewClient(
        { token: "a".repeat(32), url: "https://attacker.example/api/v1" },
        { packaged: true },
      ),
    /invalid/,
  );
});

test("allows loopback development APIs without allowing arbitrary hosts", () => {
  assert.doesNotThrow(
    () =>
      new CloudPreviewClient(
        { token: "a".repeat(32), url: "http://127.0.0.1:3333/api/v1" },
        { packaged: false },
      ),
  );
  assert.throws(
    () =>
      new CloudPreviewClient(
        {
          token: "a".repeat(32),
          url: "https://staging.attacker.example/api/v1",
        },
        { packaged: false },
      ),
    /invalid/,
  );
});

test("accepts only server-issued managed preview session IDs", () => {
  assert.equal(
    isCloudPreviewSessionId("preview_bbcb1626c004cdec3aad60175f1f0cae"),
    true,
  );
  assert.equal(isCloudPreviewSessionId("preview/../../credentials"), false);
  assert.equal(isCloudPreviewSessionId("preview-not-a-server-id"), false);
});

test("preserves structured provider failures for workspace recovery", async (context) => {
  context.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          failure: {
            code: "SOURCE_SYNC_FAILED",
            message:
              "The preview baseline expired before source synchronization.",
            providerCode: "BASELINE_SNAPSHOT_NOT_FOUND",
            retryable: true,
          },
        }),
        { status: 503 },
      ),
  );
  const client = new CloudPreviewClient({
    token: "a".repeat(32),
    url: "http://127.0.0.1:3333/api/v1",
  });

  await assert.rejects(
    () => client.get("preview_bbcb1626c004cdec3aad60175f1f0cae"),
    (error) =>
      error instanceof CloudPreviewRequestError &&
      error.status === 503 &&
      isBaselineSnapshotUnavailable(error),
  );
});

test("prepares an upload without serializing workspace bytes", async (context) => {
  let requestBody: unknown;
  context.mock.method(globalThis, "fetch", async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        artifactId: "artifact-id",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        headers: {},
        url: "https://storage.example/artifact",
      }),
      { status: 200 },
    );
  });
  const client = new CloudPreviewClient({
    token: "a".repeat(32),
    url: "http://127.0.0.1:3333/api/v1",
  });
  await client.prepareSourceUpload("preview_bbcb1626c004cdec3aad60175f1f0cae", {
    content: Buffer.alloc(1024 * 1024),
    sha256: "b".repeat(64),
    size: 1024 * 1024,
    sourceRevision: "c".repeat(40),
  });
  assert.deepEqual(requestBody, {
    action: "prepare",
    sha256: "b".repeat(64),
    size: 1024 * 1024,
    sourceRevision: "c".repeat(40),
  });
});

test("normalizes stored manifests before creating a cloud session", async (context) => {
  let requestBody: {
    sourceMetadata?: {
      sourceRevision?: string;
      workspaceHash?: string;
    };
    previewManifest?: {
      services?: Array<{ id?: string; command?: string; dependsOn?: string[] }>;
    };
  } = {};
  context.mock.method(globalThis, "fetch", async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({}), { status: 200 });
  });
  const client = new CloudPreviewClient({
    token: "a".repeat(32),
    url: "http://127.0.0.1:3333/api/v1",
  });

  await client.create({
    userStoryId: "story-id",
    profile: "vercel-compose",
    cloudUploadConsentAt: new Date().toISOString(),
    operationId: "operation-id",
    sourceMetadata: {
      sourceRevision: "a".repeat(40),
      sanitizedTreeHash: "b".repeat(64),
      lockfileHash: "c".repeat(64),
      workspaceHash: "d".repeat(64),
    },
    previewManifest: {
      confidence: "high",
      project: {
        root: ".",
        detectedStack: ["nextjs", "pnpm"],
        confidence: "high",
      },
      setup: [],
      services: [
        {
          id: "api",
          kind: "worker",
          container: { image: "node:22-bookworm" },
          command: "node api.js",
          endpoints: [{ id: "http", protocol: "http", port: 3333 }],
        },
        {
          id: "vitrine",
          kind: "preview",
          container: { image: "node:22-bookworm" },
          command:
            "corepack pnpm --filter @blame/vitrine dev -- --hostname 0.0.0.0",
          dependsOn: ["api"],
          endpoints: [
            {
              id: "http",
              protocol: "http",
              port: 3000,
              healthcheck: { type: "http", path: "/", timeoutMs: 30_000 },
            },
          ],
          bindings: [
            {
              target: { type: "environment", key: "NEXT_PUBLIC_API_URL" },
              source: { service: "api", endpoint: "http" },
              exposure: "browser",
              format: "url",
            },
          ],
        },
      ],
      caches: [],
      risks: [],
      probes: [],
    },
  });

  const vitrine = requestBody.previewManifest?.services?.find(
    ({ id }) => id === "vitrine",
  );
  assert.match(vitrine?.command ?? "", /dev --hostname 0\.0\.0\.0/);
  assert.deepEqual(vitrine?.dependsOn, []);
  assert.equal(requestBody.sourceMetadata?.workspaceHash, "d".repeat(64));
});
