import assert from "node:assert/strict";
import test from "node:test";

import { listProviders } from "./cloud-api.js";

test("loads the provider catalog and recommendations only from the protected API", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = input.toString();
    requests.push(url);
    return url.endsWith("/providers/catalog")
      ? jsonResponse(catalog)
      : jsonResponse({ data: credentials });
  };

  try {
    const providers = await listProviders({
      url: "https://api.blame.test/api/v1",
      token: "license-token",
    });

    assert.deepEqual(requests, [
      "https://api.blame.test/api/v1/providers/catalog",
      "https://api.blame.test/api/v1/providers/credentials",
    ]);
    assert.deepEqual(providers.connected, ["anthropic"]);
    assert.equal(providers.recommendations.all[0]?.modelId, "claude-test");
    assert.equal(providers.credentials.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const catalog = {
  all: [
    {
      id: "anthropic",
      name: "Anthropic",
      models: {
        "claude-test": {
          id: "claude-test",
          name: "Claude Test",
          cost: { input: 1, output: 5 },
        },
      },
    },
  ],
  default: { anthropic: "claude-test" },
  recommendations: {
    generatedAt: "2026-07-30T00:00:00.000Z",
    benchmarkBoundary: 0.74,
    all: [
      {
        providerId: "anthropic",
        modelId: "claude-test",
        position: 0.5,
        segment: "benchmarked",
        estimatedCost: 0.1,
      },
    ],
    byProvider: { anthropic: [] },
    profile: {
      inputTokens: 50_000,
      outputTokens: 5_000,
      cacheReadTokens: 0,
      sampleCount: 0,
    },
  },
};

const credentials = [
  credential("work", "credential-work"),
  credential("personal", "credential-personal"),
];

function credential(label: string, id: string) {
  return {
    id,
    userId: "user",
    providerId: "anthropic",
    label,
    baseUrl: null,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: null,
  };
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}
