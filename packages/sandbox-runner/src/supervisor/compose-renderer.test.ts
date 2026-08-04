import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "yaml";
import type { PreviewExecutionPlan } from "@blame/preview-runtime";
import {
  composeCacheVolumeName,
  renderCloudCompose,
} from "./compose-renderer.js";

test("renders hardened Compose with a shared application loopback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "blame-compose-"));
  const certificate = join(directory, "proxy-ca.pem");
  await writeFile(certificate, "certificate");
  const rendered = renderCloudCompose(
    plan(),
    {
      "backend:api": "https://backend.preview.example",
    },
    { projectUser: "1234:1234", proxyCertificatePath: certificate },
  );
  const compose = parse(rendered.yaml) as {
    services: Record<string, Record<string, unknown>>;
  };
  assert.equal(compose.services.backend.network_mode, "service:frontend");
  assert.deepEqual(compose.services.frontend.cap_drop, ["ALL"]);
  assert.deepEqual(compose.services.backend.security_opt, [
    "no-new-privileges:true",
  ]);
  assert.equal(compose.services.frontend.user, "1234:1234");
  assert.deepEqual(compose.services.backend.build, {
    context: "/workspace/apps/api",
    dockerfile: "Dockerfile",
    target: "development",
  });
  assert.equal(
    (compose.services.frontend.environment as Record<string, string>).HOME,
    "/tmp/blame-home",
  );
  assert.equal(
    (compose.services.frontend.environment as Record<string, string>)
      .XDG_CACHE_HOME,
    "/tmp/blame-home/.cache",
  );
  assert.ok(
    (compose.services.frontend.volumes as string[]).includes(
      "/workspace/.git:/workspace/.git:ro",
    ),
  );
  assert.equal(
    (compose.services.frontend.environment as Record<string, string>).API_URL,
    "http://localhost:3333",
  );
  assert.equal(rendered.targets["backend:api"]?.host, "127.0.0.1");
  assert.deepEqual(compose.services.frontend.command, [
    "/bin/sh",
    "-lc",
    'printf "%s" "$$COREPACK_HOME:$${TOKEN}:$$PATH"',
  ]);
  assert.equal(
    (compose.services.frontend.environment as Record<string, string>).TOKEN,
    "price-$$5",
  );
  assert.doesNotMatch(
    rendered.yaml,
    /docker\.sock|privileged:|pid:\s*host|ipc:\s*host/,
  );
});

test("uses the Compose project namespace for cache volumes", () => {
  assert.equal(
    composeCacheVolumeName("blame_corepack_cache"),
    "blame-preview_cache-blame_corepack_cache",
  );
});

function plan(): PreviewExecutionPlan {
  return {
    version: 2,
    workspaceRoot: "/workspace",
    setup: [],
    services: [
      {
        id: "frontend",
        kind: "preview",
        container: { image: "node:24" },
        workingDir: "/workspace",
        command: 'printf "%s" "$COREPACK_HOME:${TOKEN}:$$PATH"',
        environment: { TOKEN: "price-$5" },
        dependsOn: [],
        endpoints: [{ id: "web", protocol: "http", port: 3000 }],
        bindings: [
          {
            targetKey: "API_URL",
            sourceServiceId: "backend",
            sourceEndpointId: "api",
            exposure: "server",
            format: "url",
            path: "",
          },
        ],
      },
      {
        id: "backend",
        kind: "preview",
        container: {
          build: {
            context: "apps/api",
            dockerfile: "Dockerfile",
            target: "development",
          },
        },
        workingDir: "/workspace",
        command: "node backend.js",
        environment: {},
        dependsOn: [],
        endpoints: [{ id: "api", protocol: "http", port: 3333 }],
        bindings: [],
      },
    ],
    caches: [],
    probes: [],
    environmentPlan: { cleanupRequired: true, entries: [] },
    networking: {
      gatewayListeners: [
        {
          routeKey: "frontend:web",
          serviceId: "frontend",
          endpointId: "web",
          logicalPort: 3000,
          sandboxPort: 43000,
          targetHost: "frontend",
          targetPort: 3000,
          basePathMode: "root",
        },
      ],
      loopbackGroups: [
        {
          id: "app",
          serviceIds: ["frontend", "backend"],
          logicalPorts: [3000, 3333],
        },
      ],
      publishedPortCount: 1,
      browserBindingCount: 0,
      requiresSharedLoopback: true,
      requiresWebSockets: false,
      integratedPreviewRequired: false,
      incompatibilityReasons: [],
    },
    detectedCompatibility: [{ type: "container-engine" }],
  };
}
