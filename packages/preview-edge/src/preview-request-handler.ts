import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type {
  PreviewRouteResolver,
  ResolvedPreviewRoute,
} from "./preview-route-resolver.js";
import { PreviewSessionAuth } from "./preview-session-auth.js";
import { UpstreamCapabilitySigner } from "./upstream-capability-signer.js";

const maximumOpenBody = 8 * 1024;

export class PreviewRequestHandler {
  constructor(
    private readonly resolver: PreviewRouteResolver,
    private readonly auth: PreviewSessionAuth,
    private readonly signer: UpstreamCapabilitySigner,
    private readonly hostnameSuffix: string,
  ) {}

  async handle(request: IncomingMessage, response: ServerResponse) {
    if (isHealthCheckRequest(request.method, request.url)) {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      });
      response.end(request.method === "HEAD" ? undefined : "ok");
      return;
    }
    try {
      const hostname = this.hostname(request);
      if (request.method === "POST" && request.url === "/__blame/open") {
        await this.open(request, response, hostname);
        return;
      }
      const route = await this.authorizedRoute(request, hostname);
      await this.forward(request, response, route);
    } catch {
      if (!response.headersSent)
        response.writeHead(401, { "cache-control": "no-store" });
      response.end("Unauthorized");
    }
  }

  async authorizedRoute(
    request: IncomingMessage,
    hostname = this.hostname(request),
  ) {
    const [route, session] = await Promise.all([
      this.resolver.resolve(hostname),
      Promise.resolve(this.auth.authenticate(request.headers)),
    ]);
    if (
      !session ||
      session.sessionId !== route.sessionId ||
      session.endpointId !== route.endpointId ||
      session.ownerUserId !== route.ownerUserId
    ) {
      throw new Error("Preview session is unauthorized.");
    }
    return route;
  }

  private async open(
    request: IncomingMessage,
    response: ServerResponse,
    hostname: string,
  ) {
    const body = await readSmallBody(request);
    const contentType = request.headers["content-type"]?.split(";")[0];
    const ticket =
      contentType === "application/json"
        ? (JSON.parse(body) as { ticket?: unknown }).ticket
        : new URLSearchParams(body).get("ticket");
    if (typeof ticket !== "string")
      throw new Error("Preview ticket is missing.");
    const session = await this.resolver.consumeTicket(ticket, hostname);
    response.writeHead(303, {
      "cache-control": "no-store",
      location: "/",
      "set-cookie": this.auth.issue(session),
    });
    response.end();
  }

  private async forward(
    request: IncomingMessage,
    response: ServerResponse,
    route: ResolvedPreviewRoute,
  ) {
    const upstream = new URL(
      previewRequestTarget(request.url),
      route.upstreamUrl,
    );
    const headers = forwardedHeaders(request, route, this.signer.sign(route));
    const result = await fetch(upstream, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method ?? "GET")
        ? undefined
        : (Readable.toWeb(request) as BodyInit),
      duplex: "half",
      redirect: "manual",
      signal: AbortSignal.timeout(10 * 60_000),
    } as RequestInit & { duplex: "half" });
    const responseHeaders = forwardedResponseHeaders(
      result.headers,
      route,
      request.headers.host ?? "",
    );
    response.writeHead(result.status, responseHeaders);
    if (result.body)
      await import("node:stream/promises").then(({ pipeline }) =>
        pipeline(Readable.fromWeb(result.body as never), response),
      );
    else response.end();
  }

  private hostname(request: IncomingMessage) {
    const host = request.headers.host
      ?.split(":")[0]
      ?.toLowerCase()
      .replace(/\.$/, "");
    if (
      !host ||
      !host.endsWith(`.${this.hostnameSuffix}`) ||
      !/^[a-z0-9.-]{1,255}$/.test(host)
    ) {
      throw new Error("Preview hostname is invalid.");
    }
    return host;
  }
}

export function isHealthCheckRequest(
  method: string | undefined,
  target: string | undefined,
) {
  return (method === "GET" || method === "HEAD") && target === "/healthz";
}

function forwardedHeaders(
  request: IncomingMessage,
  route: ResolvedPreviewRoute,
  capability: string,
) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (
      value === undefined ||
      name === "host" ||
      name.startsWith("x-blame-") ||
      ["connection", "upgrade", "proxy-authorization"].includes(name)
    ) {
      continue;
    }
    if (name === "cookie") {
      const applicationCookies = withoutPreviewAuthCookie(
        Array.isArray(value) ? value.join("; ") : value,
      );
      if (applicationCookies) headers.set(name, applicationCookies);
      continue;
    }
    if (Array.isArray(value))
      value.forEach((item) => headers.append(name, item));
    else headers.set(name, value);
  }
  headers.set("x-blame-preview-capability", capability);
  headers.set("x-blame-edge-route", route.routeId);
  return headers;
}

export function withoutPreviewAuthCookie(value: string) {
  return value
    .split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie && !cookie.startsWith("__Host-blame_preview="))
    .join("; ");
}

function forwardedResponseHeaders(
  headers: Headers,
  route: ResolvedPreviewRoute,
  publicHost: string,
) {
  const result: Record<string, string | string[]> = {};
  headers.forEach((value, name) => {
    if (
      name.startsWith("x-blame-") ||
      ["connection", "transfer-encoding"].includes(name)
    )
      return;
    if (name === "location")
      result[name] = rewritePreviewLocation(value, route, publicHost);
    else if (name === "set-cookie") result[name] = safeSetCookie(headers);
    else result[name] = value;
  });
  return result;
}

function safeSetCookie(headers: Headers) {
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie")!];
  return values.map((value) =>
    value.replace(/;\s*Domain=[^;]+/gi, "").replace(/;\s*Secure/gi, "; Secure"),
  );
}

export function rewritePreviewLocation(
  value: string,
  route: ResolvedPreviewRoute,
  publicHost: string,
) {
  try {
    const location = new URL(value, route.upstreamUrl);
    const providerOrigin = new URL(route.upstreamUrl).origin;
    const logicalLoopback =
      ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) &&
      Number(location.port || (location.protocol === "https:" ? 443 : 80)) ===
        route.logicalPort;
    if (location.origin !== providerOrigin && !logicalLoopback) return value;
    location.protocol = "https:";
    location.port = "";
    location.host = publicHost;
    return location.toString();
  } catch {
    return value;
  }
}

export function previewRequestTarget(value: string | undefined) {
  if (
    !value ||
    value.length > 16_384 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\0\r\n]/.test(value)
  ) {
    throw new Error("Preview request target is invalid.");
  }
  const base = new URL("https://preview.invalid/");
  const target = new URL(value, base);
  if (target.origin !== base.origin || target.hash) {
    throw new Error("Preview request target is invalid.");
  }
  return `${target.pathname}${target.search}`;
}

async function readSmallBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > maximumOpenBody)
      throw new Error("Preview ticket request is too large.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
