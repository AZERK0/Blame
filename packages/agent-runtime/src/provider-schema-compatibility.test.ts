import assert from "node:assert/strict";
import test from "node:test";

import {
  createProviderCompatibleFetch,
  normalizeJsonSchema,
  normalizeProviderPayload,
} from "./provider-schema-compatibility.js";

test("removes provider-incompatible patterns from nested JSON schemas", () => {
  const schema = {
    type: "object",
    properties: {
      email: {
        anyOf: [
          {
            type: "string",
            pattern: "^(?!\\.)(?!.*\\.\\.)[^@]+$",
          },
        ],
      },
      slug: { type: "string", pattern: "^[a-z0-9-]+$" },
    },
  };

  const normalized = normalizeJsonSchema(schema) as typeof schema;

  assert.equal(normalized.properties.email.anyOf[0].pattern, undefined);
  assert.equal(normalized.properties.slug.pattern, "^[a-z0-9-]+$");
});

test("normalizes schemas without changing ordinary pattern fields", () => {
  const payload = {
    messages: [{ role: "user", content: { pattern: "^(?!hidden)" } }],
    tools: [
      {
        type: "function",
        function: {
          name: "assign_domain",
          parameters: {
            type: "object",
            properties: {
              value: { type: "string", pattern: "(?<=domain)name" },
            },
          },
        },
      },
    ],
  };

  const normalized = normalizeProviderPayload(payload) as typeof payload;

  assert.equal(normalized.messages[0].content.pattern, "^(?!hidden)");
  assert.equal(
    normalized.tools[0].function.parameters.properties.value.pattern,
    undefined,
  );
});

test("normalizes a JSON request body immediately before sending", async () => {
  let body: BodyInit | null | undefined;
  const request: typeof fetch = async (_input, init) => {
    body = init?.body;
    return new Response(null, { status: 204 });
  };
  const compatibleFetch = createProviderCompatibleFetch(request);

  await compatibleFetch("https://provider.test", {
    method: "POST",
    body: JSON.stringify({
      input_schema: {
        type: "object",
        properties: { value: { type: "string", pattern: "a++" } },
      },
    }),
  });

  assert.equal(typeof body, "string");
  assert.deepEqual(JSON.parse(body as string), {
    input_schema: {
      type: "object",
      properties: { value: { type: "string" } },
    },
  });
});

test("simplifies constrained tool schemas for local providers", async () => {
  let body: BodyInit | null | undefined;
  const request: typeof fetch = async (_input, init) => {
    body = init?.body;
    return new Response(null, { status: 204 });
  };
  const compatibleFetch = createProviderCompatibleFetch(request);

  await compatibleFetch("http://127.0.0.1:8080/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      tools: [
        {
          type: "function",
          function: {
            name: "run_task",
            parameters: {
              type: "object",
              properties: {
                timeout_ms: {
                  type: "integer",
                  minimum: 1_000,
                  maximum: 900_000,
                },
                symbols: {
                  type: "array",
                  maxItems: 100,
                  items: {
                    type: "string",
                    minLength: 1,
                    maxLength: 4_096,
                    pattern: "^sym:\\/\\/",
                  },
                },
              },
              required: ["timeout_ms"],
              additionalProperties: false,
            },
          },
        },
      ],
    }),
  });

  assert.deepEqual(JSON.parse(body as string), {
    tools: [
      {
        type: "function",
        function: {
          name: "run_task",
          parameters: {
            type: "object",
            properties: {
              timeout_ms: { type: "integer" },
              symbols: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["timeout_ms"],
            additionalProperties: false,
          },
        },
      },
    ],
  });
});

test("preserves supported schema constraints for remote providers", async () => {
  let body: BodyInit | null | undefined;
  const request: typeof fetch = async (_input, init) => {
    body = init?.body;
    return new Response(null, { status: 204 });
  };
  const compatibleFetch = createProviderCompatibleFetch(request);
  const payload = {
    tools: [
      {
        type: "function",
        function: {
          name: "read_range",
          parameters: {
            type: "object",
            properties: {
              offset: { type: "integer", minimum: 0, maximum: 20_000 },
              reference: {
                type: "string",
                minLength: 1,
                maxLength: 4_096,
                pattern: "^sym:\\/\\/",
              },
            },
          },
        },
      },
    ],
  };

  await compatibleFetch("https://provider.test/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  assert.deepEqual(JSON.parse(body as string), payload);
});
