import assert from "node:assert/strict";
import test from "node:test";
import { PreviewRouteTable, parseLogicalUrl } from "./preview-route-table.ts";

const grant = {
  sessionId: "session-a",
  endpointRevision: 1,
  integratedPreviewRequired: true,
  primaryRouteId: "session:frontend:http",
  routes: [
    {
      routeId: "session:frontend:http",
      serviceId: "frontend",
      endpointId: "http",
      logicalHost: "localhost" as const,
      logicalPort: 3000,
      protocol: "http" as const,
      providerUrl: "https://3000-sandbox.vercel.run",
      capability: "short-main-process-only-capability",
      capabilityExpiresAt: new Date(Date.now() + 30_000).toISOString(),
    },
  ],
};

test("routes only declared canonical loopback origins", () => {
  const table = new PreviewRouteTable();
  table.replace(grant);
  assert.equal(
    table.resolve("http://localhost:3000/api?q=1").route.endpointId,
    "http",
  );
  assert.equal(
    table.resolve("http://127.0.0.1:3000/").route.serviceId,
    "frontend",
  );
  assert.throws(() => table.resolve("http://localhost:22/"), /not declared/);
  assert.throws(() => parseLogicalUrl("http://localhost.:3000/"), /canonical/);
  assert.throws(
    () => parseLogicalUrl("http://user@localhost:3000/"),
    /invalid/,
  );
  assert.throws(() => parseLogicalUrl("http://2130706433:3000/"), /canonical/);
  assert.throws(
    () => parseLogicalUrl("http://192.168.1.10:3000/"),
    /canonical/,
  );
  assert.equal(
    table.rewriteProviderLocation(
      "https://3000-sandbox.vercel.run/login?next=%2F",
    ),
    "http://localhost:3000/login?next=%2F",
  );
  assert.equal(
    table.rewriteProviderLocation("https://example.com/"),
    "https://example.com/",
  );
});

test("rejects untrusted provider destinations", () => {
  const table = new PreviewRouteTable();
  assert.throws(
    () =>
      table.replace({
        ...grant,
        routes: [{ ...grant.routes[0]!, providerUrl: "https://evil.example" }],
      }),
    /not trusted/,
  );
});

test("uses the same logical route table for a loopback local provider", () => {
  const table = new PreviewRouteTable();
  table.replace(
    {
      ...grant,
      sessionId: "local:project",
      routes: [
        {
          ...grant.routes[0]!,
          logicalPort: 43_333,
          provider: "local",
          providerUrl: "http://127.0.0.1:43333/",
          capability: undefined,
        },
      ],
    },
    "local",
  );

  assert.equal(
    table.resolve("http://localhost:43333/api/auth/me").route.provider,
    "local",
  );
  assert.equal(
    table.rewriteProviderLocation("http://127.0.0.1:43333/login"),
    "http://localhost:43333/login",
  );
});

test("rejects a local provider outside strict loopback", () => {
  const table = new PreviewRouteTable();
  assert.throws(
    () =>
      table.replace(
        {
          ...grant,
          routes: [
            {
              ...grant.routes[0]!,
              provider: "local",
              providerUrl: "http://192.168.1.10:3000/",
              capability: undefined,
            },
          ],
        },
        "local",
      ),
    /not trusted/,
  );
});

test("does not let a cloud grant opt into loopback access", () => {
  const table = new PreviewRouteTable();
  assert.throws(
    () =>
      table.replace({
        ...grant,
        routes: [
          {
            ...grant.routes[0]!,
            provider: "local",
            providerUrl: "http://127.0.0.1:3000/",
            capability: undefined,
          },
        ],
      }),
    /does not match/,
  );
});
