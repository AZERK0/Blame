import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import type { Socket } from "node:net";
import { forwardHttpRequest, type GatewayRoute } from "./http-forwarder.js";
import { forwardWebSocket } from "./websocket-forwarder.js";
import { verifyPreviewCapability } from "./preview-auth.js";

export type EndpointGatewayConfig = {
  capabilityPublicKeyPath: string;
  routes: GatewayRoute[];
  maxConnections?: number;
};

export async function startEndpointGateway(configPath: string) {
  const config = JSON.parse(await readFile(configPath, "utf8")) as EndpointGatewayConfig;
  const publicKeyPem = await readFile(config.capabilityPublicKeyPath, "utf8");
  validateConfig(config);
  await Promise.all(
    config.routes.map((route) => listenRoute(route, publicKeyPem, config.maxConnections ?? 128)),
  );
}

function listenRoute(route: GatewayRoute, publicKeyPem: string, maxConnections: number) {
  let connections = 0;
  const server = createServer(async (request, response) => {
    if (!authorized(request.headers["x-blame-preview-capability"], route, publicKeyPem)) {
      response.writeHead(401, { "cache-control": "no-store" });
      response.end("Unauthorized");
      return;
    }
    if (connections >= maxConnections) {
      response.writeHead(429, { "retry-after": "1" });
      response.end("Too many connections");
      return;
    }
    connections += 1;
    try {
      await forwardHttpRequest(request, response, route);
    } catch {
      if (!response.headersSent) response.writeHead(502);
      response.end("Preview upstream unavailable");
    } finally {
      connections -= 1;
    }
  });
  server.on("upgrade", (request, socket: Socket, head) => {
    if (!authorized(request.headers["x-blame-preview-capability"], route, publicKeyPem)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    if (connections >= maxConnections) {
      socket.end("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
      return;
    }
    connections += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      connections -= 1;
    };
    socket.once("close", release);
    socket.once("error", release);
    forwardWebSocket(request, socket, head, route);
  });
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(route.sandboxPort, "0.0.0.0", () => resolve());
  });
}

function authorized(
  value: string | string[] | undefined,
  route: GatewayRoute,
  publicKeyPem: string,
) {
  const token = Array.isArray(value) ? undefined : value;
  return Boolean(
    verifyPreviewCapability({
      token,
      publicKeyPem,
      sessionId: route.sessionId,
      endpointId: route.endpointId,
      generation: route.generation,
    }),
  );
}

function validateConfig(config: EndpointGatewayConfig) {
  const ports = new Set<number>();
  for (const route of config.routes) {
    if (
      !route.sessionId ||
      !route.endpointId ||
      !Number.isSafeInteger(route.sandboxPort) ||
      !Number.isSafeInteger(route.targetPort) ||
      route.targetHost !== "127.0.0.1" ||
      ports.has(route.sandboxPort)
    ) {
      throw new Error("Invalid gateway route configuration.");
    }
    ports.add(route.sandboxPort);
  }
}
