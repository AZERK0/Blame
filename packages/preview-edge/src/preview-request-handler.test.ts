import assert from "node:assert/strict";
import test from "node:test";
import {
  isHealthCheckRequest,
  previewRequestTarget,
  rewritePreviewLocation,
  withoutPreviewAuthCookie,
} from "./preview-request-handler.js";

const route = {
  routeId: "route",
  sessionId: "session",
  endpointId: "web",
  serviceId: "frontend",
  logicalPort: 3000,
  generation: 1,
  ownerUserId: "owner",
  upstreamUrl: "https://provider.vercel.run",
};

test("preserves application cookies while removing only the edge auth cookie", () => {
  assert.equal(
    withoutPreviewAuthCookie(
      "theme=dark; __Host-blame_preview=secret; session=application",
    ),
    "theme=dark; session=application",
  );
});

test("rewrites provider and declared localhost redirects to the public endpoint", () => {
  assert.equal(
    rewritePreviewLocation(
      "http://localhost:3000/login",
      route,
      "route.preview.blame.dev",
    ),
    "https://route.preview.blame.dev/login",
  );
  assert.equal(
    rewritePreviewLocation(
      "https://provider.vercel.run/next",
      route,
      "route.preview.blame.dev",
    ),
    "https://route.preview.blame.dev/next",
  );
  assert.equal(
    rewritePreviewLocation(
      "https://example.com/elsewhere",
      route,
      "route.preview.blame.dev",
    ),
    "https://example.com/elsewhere",
  );
});

test("rejects absolute-form and network-path request targets", () => {
  assert.equal(previewRequestTarget("/api/items?q=1"), "/api/items?q=1");
  assert.throws(
    () => previewRequestTarget("https://evil.example/steal"),
    /invalid/,
  );
  assert.throws(() => previewRequestTarget("//evil.example/steal"), /invalid/);
  assert.throws(() => previewRequestTarget("/\\evil.example/steal"), /invalid/);
});

test("exposes only the exact health endpoint without preview authentication", () => {
  assert.equal(isHealthCheckRequest("GET", "/healthz"), true);
  assert.equal(isHealthCheckRequest("HEAD", "/healthz"), true);
  assert.equal(isHealthCheckRequest("POST", "/healthz"), false);
  assert.equal(isHealthCheckRequest("GET", "/healthz/extended"), false);
});
