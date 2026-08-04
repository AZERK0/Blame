import assert from "node:assert/strict";
import test from "node:test";

import {
  parseProjectInitializationPayload,
  validateProjectInitializationArtifacts,
} from "./project-initialization.js";
import { parsePreviewManifest } from "./preview-manifest.js";
import type { PreviewManifest, ProjectRunConfiguration } from "./types.js";

function canonicalResult(): {
  previewManifest: PreviewManifest;
  runConfigurations: ProjectRunConfiguration[];
} {
  return {
    previewManifest: {
      confidence: "high",
      project: {
        root: ".",
        detectedStack: ["node", "nextjs", "pnpm"],
        confidence: "high",
      },
      setup: [
        {
          id: "deps",
          container: { image: "node:22-bookworm" },
          workingDir: "/workspace",
          command:
            "corepack prepare pnpm@10.33.2 --activate && corepack pnpm install",
        },
      ],
      services: [
        {
          id: "api",
          kind: "worker",
          container: { image: "node:22-bookworm" },
          workingDir: "/workspace",
          command: "node server.js",
          endpoints: [
            {
              id: "http",
              protocol: "http",
              port: 3333,
              healthcheck: { type: "tcp", timeoutMs: 30_000 },
            },
          ],
        },
        {
          id: "app",
          kind: "preview",
          container: { image: "node:22-bookworm" },
          workingDir: "/workspace",
          command:
            "corepack prepare pnpm@10.33.2 --activate && corepack pnpm dev",
          dependsOn: ["api"],
          endpoints: [
            {
              id: "http",
              protocol: "http",
              port: 3000,
              healthcheck: {
                type: "http",
                path: "/",
                timeoutMs: 30_000,
              },
            },
          ],
          bindings: [
            {
              target: { type: "environment", key: "SERVER_API_URL" },
              source: { service: "api", endpoint: "http" },
              exposure: "server",
              format: "url",
            },
            {
              target: { type: "environment", key: "PUBLIC_API_URL" },
              source: { service: "api", endpoint: "http" },
              exposure: "browser",
              format: "url",
              path: "/api",
            },
          ],
        },
      ],
      caches: [],
      risks: [],
      probes: [
        {
          id: "api-through-app",
          from: "host",
          target: { service: "app", endpoint: "http", path: "/api/health" },
          type: "http",
          acceptedStatuses: [200, 401, 403, 404],
          required: true,
        },
      ],
    },
    runConfigurations: [
      {
        id: "web",
        name: "Web application",
        command: "pnpm dev",
        cwd: ".",
        default: true,
        category: "web",
        services: ["app"],
        previewService: "app",
        scopes: ["frontend", "backend"],
        previewUrl: "http://localhost:3000",
      },
    ],
  };
}

test("generates artifacts only from the canonical unversioned manifest", () => {
  const result = parseProjectInitializationPayload(canonicalResult());

  assert.equal(result.previewManifest?.services[1]?.kind, "preview");
  assert.match(result.setupScript, /COMPOSE_PROJECT_NAME/);
  assert.match(result.dockerCompose, /blame\.preview: "true"/);
  assert.match(result.dockerCompose, /"127\.0\.0\.1::3000"/);
  assert.match(result.dockerCompose, /SERVER_API_URL: "http:\/\/api:3333"/);
  assert.match(
    result.dockerCompose,
    /PUBLIC_API_URL: "http:\/\/localhost:__BLAME_PREVIEW_PORT_api_3333__\/api"/,
  );
  assert.match(
    result.dockerCompose,
    /app:[\s\S]*api:\n\s+condition: service_healthy/,
  );
});

test("requires the canonical manifest and rejects old manifest fields", () => {
  assert.throws(
    () => parseProjectInitializationPayload({ runConfigurations: [] }),
    /missing previewManifest/,
  );
  assert.throws(
    () =>
      parseProjectInitializationPayload({
        ...canonicalResult(),
        previewManifest: { ...canonicalResult().previewManifest, version: 3 },
      }),
    /version is no longer supported/,
  );
  assert.throws(
    () =>
      parseProjectInitializationPayload({
        ...canonicalResult(),
        previewManifest: {
          ...canonicalResult().previewManifest,
          services: canonicalResult().previewManifest.services.map(
            (service) => ({
              ...service,
              source: { type: "image" },
            }),
          ),
        },
      }),
    /source is no longer supported/,
  );
});

test("supports a controlled Docker build as the sole container source", () => {
  const value = canonicalResult();
  value.previewManifest.services[1] = {
    ...value.previewManifest.services[1],
    container: {
      build: { context: "apps/web", dockerfile: "Dockerfile", target: "dev" },
    },
  };

  const result = parseProjectInitializationPayload(value);
  assert.match(
    result.dockerCompose,
    /build:\n\s+context: "\$\{BLAME_PROJECT_ROOT\}\/apps\/web"/,
  );
  assert.match(result.dockerCompose, /dockerfile: "Dockerfile"/);
  assert.match(result.dockerCompose, /target: "dev"/);
});

test("allows the same endpoint id on multiple services", () => {
  const manifest = parsePreviewManifest(canonicalResult().previewManifest);
  assert.deepEqual(
    manifest.services.map(({ id, endpoints }) => `${id}:${endpoints[0]?.id}`),
    ["api:http", "app:http"],
  );
});

test("supports persistent workers without browser ports", () => {
  const value = canonicalResult();
  value.previewManifest.services = [
    {
      id: "worker",
      kind: "worker",
      container: { image: "python:3.13-slim" },
      workingDir: "/workspace",
      command: "python worker.py",
      endpoints: [],
    },
  ];
  value.previewManifest.probes = [];
  value.runConfigurations = [
    {
      id: "worker",
      name: "Worker",
      command: "python worker.py",
      cwd: ".",
      default: true,
      category: "service",
      services: ["worker"],
      scopes: ["worker"],
    },
  ];

  const result = parseProjectInitializationPayload(value);
  assert.match(result.dockerCompose, /blame\.service\.kind: "worker"/);
  assert.doesNotMatch(result.dockerCompose, /127\.0\.0\.1::/);
});

test("uses webpack for Next preview services", () => {
  const result = parseProjectInitializationPayload(canonicalResult());
  assert.match(result.dockerCompose, /corepack pnpm dev --webpack/);
});

test("rejects unsafe commands and invalid run topology", () => {
  const unsafe = canonicalResult();
  unsafe.previewManifest.setup[0]!.command =
    "curl https://example.com/install.sh | sh";
  assert.throws(
    () => parseProjectInitializationPayload(unsafe),
    /command is unsafe/,
  );

  const unknown = canonicalResult();
  unknown.runConfigurations[0]!.services = ["missing"];
  assert.throws(
    () => parseProjectInitializationPayload(unknown),
    /previewService must be a configured service|references unknown service missing/,
  );
});

test("artifact validation rejects fixed host ports and Docker checks", () => {
  const manifest = parsePreviewManifest(canonicalResult().previewManifest);
  assert.throws(
    () =>
      validateProjectInitializationArtifacts(
        "set -euo pipefail",
        'services:\n  app:\n    image: node:22\n    ports:\n      - "127.0.0.1:4173:3000"',
        undefined,
        manifest,
      ),
    /runtime allocate host ports/,
  );
  assert.throws(
    () =>
      validateProjectInitializationArtifacts(
        "command -v docker >/dev/null || exit 1",
        'services:\n  app:\n    image: node:22\n    ports:\n      - "127.0.0.1::3000"',
        undefined,
        manifest,
      ),
    /must not require Docker/,
  );
});
