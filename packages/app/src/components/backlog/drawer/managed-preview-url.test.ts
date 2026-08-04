import assert from "node:assert/strict"
import test from "node:test"
import {
  managedEmbeddedPreviewUrl,
  primaryPreviewRoute,
} from "./managed-preview-url.ts"

test("uses the logical localhost route for every embedded managed preview", () => {
  assert.equal(
    managedEmbeddedPreviewUrl({
      revision: 1,
      primaryRouteId: "session:web:http",
      primaryPublicUrl: "https://preview.example.test",
      routes: [
        {
          basePathMode: "root",
          routeId: "session:web:http",
          serviceId: "web",
          endpointId: "http",
          externallyCompatible: true,
          logicalHost: "localhost",
          logicalPort: 3000,
          protocol: "http",
          publicUrl: "https://preview.example.test",
          sandboxPort: 41000,
          targetHost: "127.0.0.1",
          targetPort: 3000,
        },
      ],
      supportsWebSocket: true,
      integratedPreviewRequired: false,
      incompatibilityReasons: [],
    }),
    "http://localhost:3000"
  )
})

test("does not expose a provider URL when no logical route is ready", () => {
  assert.equal(managedEmbeddedPreviewUrl(undefined), undefined)
})

test("selects an explicit service and endpoint pair for the primary route", () => {
  assert.deepEqual(
    primaryPreviewRoute(
      {
        confidence: "high",
        project: {},
        setup: [],
        caches: [],
        risks: [],
        probes: [],
        services: [
          {
            id: "api",
            kind: "preview",
            container: { image: "node:24" },
            command: "true",
            endpoints: [{ id: "http", protocol: "http", port: 3333 }],
          },
          {
            id: "app",
            kind: "preview",
            container: { image: "node:24" },
            command: "true",
            endpoints: [
              { id: "metrics", protocol: "http", port: 3001 },
              { id: "http", protocol: "http", port: 3000 },
            ],
          },
        ],
      },
      {
        id: "web",
        name: "Web application",
        command: "pnpm dev",
        cwd: ".",
        default: true,
        category: "web",
        services: ["app", "api"],
        previewService: "app",
        previewUrl: "http://localhost:3000",
      }
    ),
    { serviceId: "app", endpointId: "http" }
  )
})
