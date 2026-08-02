#!/usr/bin/env node
import { createServer } from "node:http";
import { ApiPreviewRouteResolver } from "./preview-route-resolver.js";
import { PreviewSessionAuth } from "./preview-session-auth.js";
import { UpstreamCapabilitySigner } from "./upstream-capability-signer.js";
import { PreviewRequestHandler } from "./preview-request-handler.js";
import { forwardPreviewWebSocket } from "./websocket-forwarder.js";

const config = edgeConfig(process.env);
const resolver = new ApiPreviewRouteResolver(config.controlOrigin, config.controlToken);
const auth = new PreviewSessionAuth(config.cookieSecret);
const signer = new UpstreamCapabilitySigner(config.capabilityPrivateKey);
const handler = new PreviewRequestHandler(resolver, auth, signer, config.hostnameSuffix);
const server = createServer((request, response) => void handler.handle(request, response));

server.on("upgrade", async (request, socket, head) => {
  try {
    const route = await handler.authorizedRoute(request);
    forwardPreviewWebSocket(request, socket, head, route, signer);
  } catch {
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
  }
});

server.listen(config.port, config.host);

function edgeConfig(environment: NodeJS.ProcessEnv) {
  return {
    host: environment.HOST ?? "0.0.0.0",
    port: positiveInteger(environment.PORT, 8080),
    controlOrigin: required(environment.BLAME_PREVIEW_EDGE_CONTROL_ORIGIN, "control origin"),
    controlToken: required(environment.BLAME_PREVIEW_EDGE_CONTROL_TOKEN, "control token"),
    cookieSecret: required(environment.BLAME_PREVIEW_EDGE_COOKIE_SECRET, "cookie secret"),
    capabilityPrivateKey: normalizePem(
      required(environment.BLAME_PREVIEW_CAPABILITY_PRIVATE_KEY, "capability private key"),
    ),
    hostnameSuffix: required(environment.BLAME_PREVIEW_HOSTNAME_SUFFIX, "hostname suffix")
      .toLowerCase()
      .replace(/^\./, ""),
  };
}

function required(value: string | undefined, name: string) {
  if (!value) throw new Error(`Missing Preview Edge ${name}.`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < 1 || number > 65_535) {
    throw new Error("Invalid Preview Edge port.");
  }
  return number;
}

function normalizePem(value: string) {
  return value.replaceAll("\\n", "\n");
}
