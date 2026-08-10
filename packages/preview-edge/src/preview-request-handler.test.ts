import assert from "node:assert/strict";
import {
  createServer,
  get,
  type IncomingHttpHeaders,
  type IncomingMessage,
} from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  PreviewRequestHandler,
  forwardedResponseHeaders,
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

test("preserves upstream content encoding for raw compressed responses", () => {
  assert.deepEqual(
    forwardedResponseHeaders(
      {
        connection: "keep-alive",
        "content-encoding": "gzip",
        "content-length": "123",
        "content-type": "text/html; charset=utf-8",
        "transfer-encoding": "chunked",
      },
      route,
      "route.preview.blame.dev",
    ),
    {
      "content-encoding": "gzip",
      "content-length": "123",
      "content-type": "text/html; charset=utf-8",
    },
  );
});

test("forwards compressed upstream bodies without decoding them", async () => {
  const body = gzipSync(Buffer.from("<html>compressed preview</html>"));
  const upstream = createServer((request, response) => {
    assert.equal(request.headers["x-blame-preview-capability"], "capability");
    response.writeHead(200, {
      "content-encoding": "gzip",
      "content-length": body.length,
      "content-type": "text/html; charset=utf-8",
    });
    response.end(body);
  });
  await listen(upstream);
  const upstreamAddress = upstream.address() as AddressInfo;
  const handler = new PreviewRequestHandler(
    {
      resolve: async () => ({
        ...route,
        upstreamUrl: `http://127.0.0.1:${upstreamAddress.port}`,
      }),
      consumeTicket: async () => {
        throw new Error("ticket flow is not used by public routes");
      },
    },
    new PreviewSessionAuth("a-secure-cookie-secret-with-more-than-32-bytes"),
    { sign: () => "capability" } as unknown as UpstreamCapabilitySigner,
    "preview.blame.dev",
  );
  const edge = createServer((request, response) => {
    void handler.handle(request, response);
  });
  await listen(edge);

  try {
    const edgeAddress = edge.address() as AddressInfo;
    const result = await request({
      host: "127.0.0.1",
      port: edgeAddress.port,
      headers: { host: "route.preview.blame.dev" },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["content-encoding"], "gzip");
    assert.equal(result.headers["content-length"], String(body.length));
    assert.deepEqual(result.body, body);
  } finally {
    await Promise.all([close(edge), close(upstream)]);
  }
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

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function request(options: {
  host: string;
  port: number;
  headers: IncomingHttpHeaders;
}) {
  return new Promise<{
    statusCode: number | undefined;
    headers: IncomingHttpHeaders;
    body: Buffer;
  }>((resolve, reject) => {
    get(options, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () =>
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks),
        }),
      );
    }).once("error", reject);
  });
}
