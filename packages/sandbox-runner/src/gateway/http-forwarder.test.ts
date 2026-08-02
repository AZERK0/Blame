import assert from "node:assert/strict";
import test from "node:test";
import { forwardedRequestHeaders, gatewayRequestTarget } from "./http-forwarder.js";

test("keeps gateway requests on their declared upstream", () => {
  assert.equal(gatewayRequestTarget("/api/items?q=1"), "/api/items?q=1");
  assert.throws(() => gatewayRequestTarget("http://169.254.169.254/latest"), /Invalid/);
  assert.throws(() => gatewayRequestTarget("//169.254.169.254/latest"), /Invalid/);
  assert.throws(() => gatewayRequestTarget("/\\169.254.169.254/latest"), /Invalid/);
});

test("preserves logical cross-origin CORS headers", () => {
  const headers = forwardedRequestHeaders(
    {
      host: "provider.vercel.run",
      origin: "http://localhost:3000",
      referer: "http://localhost:3000/dashboard",
      "x-blame-preview-capability": "remove-me",
    },
    {
      sessionId: "session",
      endpointId: "api",
      generation: 1,
      logicalPort: 3333,
      sandboxPort: 43001,
      targetHost: "127.0.0.1",
      targetPort: 44001,
    },
  );
  assert.equal(headers.host, "localhost:3333");
  assert.equal(headers.origin, "http://localhost:3000");
  assert.equal(headers.referer, "http://localhost:3000/dashboard");
  assert.equal(headers["x-blame-preview-capability"], undefined);
});
