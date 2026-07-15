const schemaContainerKeys = new Set([
  "inputSchema",
  "input_schema",
  "parameters",
  "schema",
]);

export function createProviderCompatibleFetch(
  request: typeof fetch = globalThis.fetch,
): typeof fetch {
  return (input, init) => request(input, compatibleRequestInit(init));
}

export function normalizeProviderPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeProviderPayload);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      schemaContainerKeys.has(key)
        ? normalizeJsonSchema(child)
        : normalizeProviderPayload(child),
    ]),
  );
}

export function normalizeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonSchema);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      if (key === "pattern" && unsupportedProviderPattern(child)) return [];
      return [[key, normalizeJsonSchema(child)]];
    }),
  );
}

function compatibleRequestInit(init?: RequestInit) {
  if (typeof init?.body !== "string") return init;
  const body = compatibleJsonBody(init.body);
  return body === init.body ? init : { ...init, body };
}

function compatibleJsonBody(body: string) {
  try {
    return JSON.stringify(normalizeProviderPayload(JSON.parse(body)));
  } catch {
    return body;
  }
}

function unsupportedProviderPattern(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    new RegExp(value);
  } catch {
    return true;
  }
  return unsupportedRegexSyntax(value);
}

function unsupportedRegexSyntax(pattern: string) {
  return (
    /(^|[^\\])\(\?(?:[=!]|<[=!]|>|\()/.test(pattern) ||
    /(^|[^\\])\\(?:[1-9]|k<)/.test(pattern) ||
    /(^|[^\\])(?:[+*?]|\{\d+(?:,\d*)?\})\+/.test(pattern)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
