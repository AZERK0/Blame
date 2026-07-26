import type {
  CloudAuthRequestInput,
  CloudAuthRequestResponse,
} from "@blame/app";

const productionApiOrigin = "https://api.blame.so";
const productionAuthPath = "/api/v1/auth/";
const maximumBodyLength = 128 * 1024;

type CloudAuthRequestOptions = {
  cookieJar: CloudAuthCookieJar;
  fetcher?: typeof globalThis.fetch;
  packaged: boolean;
};

export class CloudAuthCookieJar {
  private readonly cookies = new Map<string, string>();

  header() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  update(headers: Headers) {
    for (const value of setCookieValues(headers)) this.updateCookie(value);
  }

  private updateCookie(setCookie: string) {
    const [pair, ...attributes] = setCookie.split(";");
    const separator = pair?.indexOf("=") ?? -1;
    if (!pair || separator <= 0) return;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (expiredCookie(attributes)) this.cookies.delete(name);
    else this.cookies.set(name, value);
  }
}

export async function sendCloudAuthRequest(
  input: unknown,
  options: CloudAuthRequestOptions,
): Promise<CloudAuthRequestResponse> {
  const request = validatedRequest(input, options.packaged);
  const headers = cloudAuthHeaders(
    request.headers,
    request.url,
    options.cookieJar,
  );
  const response = await (options.fetcher ?? globalThis.fetch)(request.url, {
    body: request.body,
    headers,
    method: request.method,
    redirect: "manual",
  });
  options.cookieJar.update(response.headers);
  return {
    body: await response.text(),
    headers: responseHeaders(response.headers),
    status: response.status,
  };
}

function validatedRequest(input: unknown, packaged: boolean) {
  if (!isCloudAuthRequest(input))
    throw new Error("Invalid cloud authentication request.");
  if (input.method.toUpperCase() !== "POST") {
    throw new Error("Unsupported cloud authentication method.");
  }
  if ((input.body?.length ?? 0) > maximumBodyLength) {
    throw new Error("Cloud authentication request is too large.");
  }
  const url = allowedCloudAuthUrl(input.url, packaged);
  if (!url) throw new Error("Cloud authentication target is not allowed.");
  return { ...input, method: "POST", url: url.toString() };
}

function isCloudAuthRequest(input: unknown): input is CloudAuthRequestInput {
  if (!input || typeof input !== "object") return false;
  const value = input as Partial<CloudAuthRequestInput>;
  if (value.body !== undefined && typeof value.body !== "string") return false;
  return (
    typeof value.method === "string" &&
    typeof value.url === "string" &&
    validHeaderRecord(value.headers)
  );
}

function validHeaderRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((header) => typeof header === "string");
}

function allowedCloudAuthUrl(value: string, packaged: boolean) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return null;
    if (productionCloudAuthUrl(url)) return url;
    return !packaged && developmentCloudAuthUrl(url) ? url : null;
  } catch {
    return null;
  }
}

function productionCloudAuthUrl(url: URL) {
  return (
    url.origin === productionApiOrigin &&
    url.pathname.startsWith(productionAuthPath)
  );
}

function developmentCloudAuthUrl(url: URL) {
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  return (
    ["http:", "https:"].includes(url.protocol) &&
    loopbackHosts.has(url.hostname) &&
    /\/auth(?:\/|$)/.test(url.pathname)
  );
}

function cloudAuthHeaders(
  input: Record<string, string>,
  requestUrl: string,
  cookieJar: CloudAuthCookieJar,
) {
  const headers = new Headers(input);
  for (const name of restrictedRequestHeaders(headers)) headers.delete(name);
  headers.set("Origin", new URL(requestUrl).origin);
  const cookies = cookieJar.header();
  if (cookies) headers.set("Cookie", cookies);
  return headers;
}

function restrictedRequestHeaders(headers: Headers) {
  return Array.from(headers.keys()).filter(
    (name) =>
      ["content-length", "cookie", "host", "origin", "referer"].includes(
        name,
      ) || name.startsWith("sec-fetch-"),
  );
}

function responseHeaders(headers: Headers) {
  return Object.fromEntries(
    Array.from(headers.entries()).filter(([name]) => name !== "set-cookie"),
  );
}

function setCookieValues(headers: Headers) {
  return typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : headers.get("set-cookie")
      ? [headers.get("set-cookie") as string]
      : [];
}

function expiredCookie(attributes: string[]) {
  const normalized = attributes.map((attribute) =>
    attribute.trim().toLowerCase(),
  );
  if (normalized.some((attribute) => attribute === "max-age=0")) return true;
  const expires = normalized.find((attribute) =>
    attribute.startsWith("expires="),
  );
  if (!expires) return false;
  const expiration = Date.parse(expires.slice("expires=".length));
  return Number.isFinite(expiration) && expiration <= Date.now();
}
