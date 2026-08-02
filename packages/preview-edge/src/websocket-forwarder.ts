import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import tls from "node:tls";
import type { ResolvedPreviewRoute } from "./preview-route-resolver.js";
import { UpstreamCapabilitySigner } from "./upstream-capability-signer.js";
import { previewRequestTarget, withoutPreviewAuthCookie } from "./preview-request-handler.js";

export function forwardPreviewWebSocket(
  request: IncomingMessage,
  client: Duplex,
  head: Buffer,
  route: ResolvedPreviewRoute,
  signer: UpstreamCapabilitySigner,
) {
  if (request.method !== "GET" || request.headers.upgrade?.toLowerCase() !== "websocket") {
    client.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    return;
  }
  const upstreamUrl = new URL(route.upstreamUrl);
  const path = previewRequestTarget(request.url);
  if (upstreamUrl.protocol !== "https:") {
    client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    return;
  }
  const upstream = tls.connect({
    host: upstreamUrl.hostname,
    port: Number(upstreamUrl.port || 443),
    servername: upstreamUrl.hostname,
    ALPNProtocols: ["http/1.1"],
  });
  upstream.setTimeout(10 * 60_000);
  upstream.once("secureConnect", () => {
    const lines = [
      `${request.method ?? "GET"} ${path} HTTP/1.1`,
      `host: ${upstreamUrl.host}`,
      ...forwardedUpgradeHeaders(request),
      `x-blame-preview-capability: ${signer.sign(route)}`,
      `x-blame-edge-route: ${route.routeId}`,
      "",
      "",
    ];
    upstream.write(lines.join("\r\n"));
    if (head.length) upstream.write(head);
    client.pipe(upstream).pipe(client);
  });
  const close = () => {
    upstream.destroy();
    client.destroy();
  };
  upstream.once("timeout", close);
  upstream.once("error", close);
  client.once("error", close);
  client.once("close", close);
}

function forwardedUpgradeHeaders(request: IncomingMessage) {
  return Object.entries(request.headers).flatMap(([name, value]) => {
    if (
      value === undefined ||
      name === "host" ||
      name.startsWith("x-blame-") ||
      ["proxy-authorization", "proxy-authenticate"].includes(name)
    ) {
      return [];
    }
    const values = Array.isArray(value) ? value : [value];
    if (name === "cookie") {
      const cookies = withoutPreviewAuthCookie(values.join("; "));
      return cookies ? [`cookie: ${cookies}`] : [];
    }
    return values.map((item) => `${name}: ${item}`);
  });
}
