import assert from "node:assert/strict"
import test from "node:test"
import { managedEmbeddedPreviewUrl } from "./managed-preview-url.ts"

test("uses the logical localhost route for every embedded managed preview", () => {
  assert.equal(
    managedEmbeddedPreviewUrl({
      revision: 1,
      primaryEndpointId: "web",
      primaryPublicUrl: "https://preview.example.test",
      routes: [
        {
          basePathMode: "root",
          endpointId: "web",
          externallyCompatible: true,
          logicalHost: "localhost",
          logicalPort: 3000,
          protocol: "http",
          publicUrl: "https://preview.example.test",
          sandboxPort: 41000,
          serviceId: "web",
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
