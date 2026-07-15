import assert from "node:assert/strict";
import test from "node:test";
import { parsePreviewManifest } from "./parser.js";

function manifest() {
  return {
    version: 2,
    confidence: "high",
    project: { root: ".", detectedStack: ["nuxt"] },
    setup: [],
    services: [
      {
        id: "backend",
        kind: "worker",
        image: "node:22-bookworm",
        command: "node server.js",
        endpoints: [
          {
            id: "http",
            protocol: "http",
            port: 3333,
            healthcheck: { type: "tcp", timeoutMs: 60_000 },
          },
        ],
      },
      {
        id: "web",
        kind: "preview",
        image: "node:22-bookworm",
        command: "npm run dev",
        dependsOn: ["backend"],
        preview: { internalPort: 3000, protocol: "http", path: "/" },
        healthcheck: { type: "http", path: "/", timeoutMs: 60_000 },
        endpoints: [{ id: "http", protocol: "http", port: 3000 }],
        bindings: [
          {
            target: { type: "environment", key: "API_URL" },
            source: { service: "backend", endpoint: "http" },
            exposure: "server",
          },
        ],
      },
    ],
    probes: [
      {
        id: "api-proxy",
        from: "host",
        target: { service: "web", endpoint: "http", path: "/api/health" },
        type: "http",
        acceptedStatuses: [200, 401],
      },
    ],
    caches: [],
    risks: [],
  };
}

test("accepts typed service bindings and probes", () => {
  const parsed = parsePreviewManifest(manifest());
  assert.equal(parsed.services[1]?.bindings?.[0]?.source.service, "backend");
  assert.deepEqual(parsed.probes?.[0]?.acceptedStatuses, [200, 401]);
});

test("allows explicit browser bindings to backend services", () => {
  const value = manifest();
  value.services[1].bindings![0].exposure = "browser";
  assert.equal(
    parsePreviewManifest(value).services[1]?.bindings?.[0]?.exposure,
    "browser",
  );
});

test("rejects dependency cycles", () => {
  const value = manifest();
  value.services[0].dependsOn = ["web"];
  assert.throws(() => parsePreviewManifest(value), /must not contain cycles/);
});

test("requires version two endpoint and probe declarations", () => {
  const withoutProbes = manifest() as Record<string, any>;
  delete withoutProbes.probes;
  assert.throws(
    () => parsePreviewManifest(withoutProbes),
    /version 2 must define probes/,
  );

  const withoutEndpoints = manifest() as Record<string, any>;
  delete withoutEndpoints.services[0].endpoints;
  delete withoutEndpoints.services[1].bindings;
  assert.throws(
    () => parsePreviewManifest(withoutEndpoints),
    /must define endpoints/,
  );
});

test("never allows functional probes to accept server errors", () => {
  const value = manifest();
  value.probes[0].acceptedStatuses = [200, 502];
  assert.throws(
    () => parsePreviewManifest(value),
    /acceptedStatuses is invalid/,
  );
});

test("keeps version one manifests compatible", () => {
  const value = manifest() as Record<string, any>;
  value.version = 1;
  delete value.services[0].endpoints;
  delete value.services[1].endpoints;
  delete value.services[1].bindings;
  delete value.probes;
  const parsed = parsePreviewManifest(value);
  assert.equal(parsed.version, 1);
});
