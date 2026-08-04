import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import type { PreviewExecutionPlan } from "@blame/preview-runtime";
import { probeServices } from "./service-probes.js";

test("retries health checks during the declared readiness window", async () => {
  let attempts = 0;
  const server = createServer((_request, response) => {
    attempts += 1;
    response.statusCode = attempts < 3 ? 503 : 204;
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const result = await probeServices(plan(), {
      "web:http": { host: "127.0.0.1", port: address.port },
    });
    assert.equal(result[0]?.healthy, true);
    assert.equal(attempts, 3);
  } finally {
    server.close();
    await once(server, "close");
  }
});

function plan(): PreviewExecutionPlan {
  return {
    version: 2,
    workspaceRoot: "/workspace",
    setup: [],
    services: [
      {
        id: "web",
        kind: "preview",
        container: { image: "node:24" },
        workingDir: ".",
        command: "start-web",
        environment: {},
        dependsOn: [],
        bindings: [],
        endpoints: [
          {
            id: "http",
            protocol: "http",
            port: 3_000,
            healthcheck: { type: "http", path: "/health", timeoutMs: 1_000 },
          },
        ],
      },
    ],
    caches: [],
    probes: [],
    environmentPlan: { entries: [], cleanupRequired: true },
    networking: {
      gatewayListeners: [],
      loopbackGroups: [],
      publishedPortCount: 0,
      browserBindingCount: 0,
      requiresSharedLoopback: false,
      requiresWebSockets: false,
      integratedPreviewRequired: false,
      incompatibilityReasons: [],
    },
    detectedCompatibility: [],
  };
}
