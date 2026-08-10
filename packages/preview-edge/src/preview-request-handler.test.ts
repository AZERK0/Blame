import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import test from "node:test";
import {
  PreviewRequestHandler,
  isHealthCheckRequest,
  previewEdgeFailure,
  previewRequestTarget,
  rewritePreviewLocation,
  withoutPreviewAuthCookie,
} from "./preview-request-handler.js";
import { PreviewControlRequestError } from "./preview-route-resolver.js";
import { PreviewSessionAuth } from "./preview-session-auth.js";
import type { UpstreamCapabilitySigner } from "./upstream-capability-signer.js";

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

test("allows a direct request with only the opaque public route", async () => {
  const handler = new PreviewRequestHandler(
    {
      resolve: async () => route,
      consumeTicket: async () => {
        throw new Error("ticket flow is not used by public routes");
      },
    },
    new PreviewSessionAuth("a-secure-cookie-secret-with-more-than-32-bytes"),
    {} as UpstreamCapabilitySigner,
    "preview.blame.dev",
  );
  const resolved = await handler.authorizedRoute({
    headers: { host: "route.preview.blame.dev" },
  } as IncomingMessage);
  assert.equal(resolved.routeId, route.routeId);
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

test("classifies control-plane authorization and route failures", () => {
  assert.equal(
    previewEdgeFailure(new PreviewControlRequestError(401)),
    "control-unauthorized",
  );
  assert.equal(
    previewEdgeFailure(new PreviewControlRequestError(404)),
    "route-unavailable",
  );
  assert.equal(
    previewEdgeFailure(new PreviewControlRequestError(503)),
    "control-unavailable",
  );
});
