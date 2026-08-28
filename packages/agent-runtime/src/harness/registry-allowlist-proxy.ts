import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect, type Socket } from "node:net";
import { join, relative, resolve, sep } from "node:path";
import type { Duplex } from "node:stream";

export type RegistryAllowlistProxy = {
  allowedHosts: string[];
  close(): Promise<void>;
  url: string;
};

export async function startRegistryAllowlistProxy(input: {
  cwd: string;
  overlayRoot: string;
  signal?: AbortSignal;
}): Promise<RegistryAllowlistProxy> {
  const allowedHosts = await configuredRegistryHosts(
    input.overlayRoot,
    input.cwd,
  );
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    void forwardHttpRequest(request, response, allowedHosts).catch((error) => {
      response.writeHead(
        error instanceof Error && error.message === "REGISTRY_HOST_NOT_ALLOWED"
          ? 403
          : 502,
        { "content-type": "text/plain" },
      );
      response.end(error instanceof Error ? error.message : String(error));
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("connect", (request, client, head) => {
    void openTunnel(request.url, client, head, allowedHosts).catch(() => {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    });
  });
  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListening();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("REGISTRY_PROXY_UNAVAILABLE:No local proxy port.");
  }
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    input.signal?.removeEventListener("abort", closeOnAbort);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolveClosed) =>
      server.close(() => resolveClosed()),
    );
  };
  const closeOnAbort = () => void close();
  input.signal?.addEventListener("abort", closeOnAbort, { once: true });
  return {
    allowedHosts: [...allowedHosts].sort(),
    close,
    url: `http://127.0.0.1:${address.port}`,
  };
}

export async function configuredRegistryHosts(
  overlayRoot: string,
  cwd = overlayRoot,
) {
  const hosts = new Set(["registry.npmjs.org"]);
  const safeCwd = workspaceRelativeDirectory(overlayRoot, cwd);
  const configPaths = [
    join(overlayRoot, ".npmrc"),
    join(overlayRoot, ".yarnrc"),
    join(overlayRoot, ".yarnrc.yml"),
    join(overlayRoot, "package.json"),
    ...(safeCwd && safeCwd !== overlayRoot
      ? [
          join(safeCwd, ".npmrc"),
          join(safeCwd, ".yarnrc"),
          join(safeCwd, ".yarnrc.yml"),
          join(safeCwd, "package.json"),
        ]
      : []),
  ];
  for (const path of [...new Set(configPaths)]) {
    const source = await readFile(path, "utf8").catch(() => undefined);
    if (!source) continue;
    for (const registry of registryUrls(path, source)) {
      try {
        const url = new URL(registry);
        if (url.protocol === "https:" || url.protocol === "http:")
          hosts.add(url.hostname.toLowerCase());
      } catch {
        // Ignore malformed registry values; the package manager will report them.
      }
    }
  }
  return hosts;
}

function registryUrls(path: string, source: string) {
  if (path.endsWith("package.json")) {
    try {
      const manifest = JSON.parse(source) as Record<string, unknown>;
      const publishConfig = recordValue(manifest.publishConfig);
      return typeof publishConfig.registry === "string"
        ? [publishConfig.registry]
        : [];
    } catch {
      return [];
    }
  }
  return [...source.matchAll(registryLinePattern)].flatMap((match) =>
    match[1] ? [match[1].replace(/["']$/u, "")] : [],
  );
}

const registryLinePattern =
  /^\s*(?:@[^:\s]+:)?(?:registry|npmRegistryServer)\s*[:=]\s*["']?(https?:\/\/[^\s"']+)/gimu;

async function openTunnel(
  target: string | undefined,
  client: Duplex,
  head: Buffer,
  allowedHosts: Set<string>,
) {
  const parsed = parseTunnelTarget(target);
  const address = await allowedAddress(parsed.hostname, allowedHosts);
  const upstream = connect({ host: address, port: parsed.port });
  upstream.once("error", () => client.destroy());
  client.once("error", () => upstream.destroy());
  upstream.once("connect", () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.byteLength) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
}

async function forwardHttpRequest(
  incoming: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  allowedHosts: Set<string>,
) {
  const target = new URL(incoming.url ?? "");
  const address = await allowedAddress(target.hostname, allowedHosts);
  const request = (target.protocol === "https:" ? httpsRequest : httpRequest)(
    {
      headers: { ...incoming.headers, host: target.host },
      host: address,
      method: incoming.method,
      path: `${target.pathname}${target.search}`,
      port: Number(target.port) || (target.protocol === "https:" ? 443 : 80),
      servername: target.hostname,
    },
    (upstream) => {
      response.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(response);
    },
  );
  request.once("error", (error) => response.destroy(error));
  incoming.pipe(request);
}

async function allowedAddress(hostname: string, allowedHosts: Set<string>) {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  if (!allowedHosts.has(normalized))
    throw new Error("REGISTRY_HOST_NOT_ALLOWED");
  const addresses = await lookup(normalized, { all: true, verbatim: true });
  const address = addresses.find((candidate) =>
    publicAddress(candidate.address),
  );
  if (!address) throw new Error("REGISTRY_ADDRESS_NOT_ALLOWED");
  return address.address;
}

function publicAddress(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.startsWith("::ffff:"))
    return publicAddress(normalized.slice("::ffff:".length));
  if (normalized.includes(":"))
    return !(
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("ff")
    );
  const octets = normalized.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet)))
    return false;
  const [first, second] = octets;
  return !(
    first === 0 ||
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function parseTunnelTarget(value: string | undefined) {
  if (!value) throw new Error("REGISTRY_PROXY_TARGET_MISSING");
  const parsed = new URL(`http://${value}`);
  return {
    hostname: parsed.hostname,
    port: Number(parsed.port) || 443,
  };
}

function workspaceRelativeDirectory(root: string, cwd: string) {
  const absoluteRoot = resolve(root);
  const absoluteCwd = resolve(cwd);
  const path = relative(absoluteRoot, absoluteCwd);
  if (path === "") return absoluteRoot;
  if (path === ".." || path.startsWith(`..${sep}`)) return undefined;
  return resolve(absoluteRoot, path);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
