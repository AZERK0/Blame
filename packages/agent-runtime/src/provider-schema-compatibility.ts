const schemaContainerKeys = new Set([
  "inputSchema",
  "input_schema",
  "parameters",
  "schema",
]);

const localGrammarConstraintKeys = new Set([
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
  "pattern",
]);

const localProviderHosts = new Set(["127.0.0.1", "[::1]", "localhost"]);

type SchemaNormalizationOptions = {
  simplifyLocalGrammar?: boolean;
};

export function createProviderCompatibleFetch(
  request: typeof fetch = globalThis.fetch,
): typeof fetch {
  return (input, init) => request(input, compatibleRequestInit(input, init));
}

export function normalizeProviderPayload(
  value: unknown,
  options: SchemaNormalizationOptions = {},
): unknown {
  if (Array.isArray(value))
    return value.map((child) => normalizeProviderPayload(child, options));
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      schemaContainerKeys.has(key)
        ? normalizeJsonSchema(child, options)
        : normalizeProviderPayload(child, options),
    ]),
  );
}

export function normalizeJsonSchema(
  value: unknown,
  options: SchemaNormalizationOptions = {},
): unknown {
  if (Array.isArray(value))
    return value.map((child) => normalizeJsonSchema(child, options));
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      if (options.simplifyLocalGrammar && localGrammarConstraintKeys.has(key))
        return [];
      if (key === "pattern" && unsupportedProviderPattern(child)) return [];
      return [[key, normalizeJsonSchema(child, options)]];
    }),
  );
}

function compatibleRequestInit(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
) {
  if (typeof init?.body !== "string") return init;
  const body = compatibleJsonBody(init.body, {
    simplifyLocalGrammar: isLocalProviderRequest(input),
  });
  return body === init.body ? init : { ...init, body };
}

function compatibleJsonBody(body: string, options: SchemaNormalizationOptions) {
  try {
    return JSON.stringify(normalizeProviderPayload(JSON.parse(body), options));
  } catch {
    return body;
  }
}

function isLocalProviderRequest(input: Parameters<typeof fetch>[0]) {
  try {
    return localProviderHosts.has(new URL(requestUrl(input)).hostname);
  } catch {
    return false;
  }
}

function requestUrl(input: Parameters<typeof fetch>[0]) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
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
