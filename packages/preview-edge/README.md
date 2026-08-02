# Blame Preview Edge

Preview Edge is the only public entrypoint to managed preview listeners. It
exchanges one-use opening tickets for short `HttpOnly` cookies, resolves opaque
routes through the authenticated control-plane API, and signs a short Ed25519
capability for the exact session, endpoint, and generation. HTTP streaming, SSE,
cookies, redirects, and WebSocket upgrades are proxied without exposing the raw
Vercel URL.

The private signing key and control token are server-only. The matching public
key is written to the trusted gateway area in each sandbox; it is not a secret.

## Container deployment

The Dockerfile is built from the repository root because Preview Edge belongs to
the pnpm workspace:

```sh
docker build -f packages/preview-edge/Dockerfile -t blame-preview-edge .
docker run --rm -p 8080:8080 --env-file /secure/preview-edge.env blame-preview-edge
```

`GET /healthz` and `HEAD /healthz` are the only unauthenticated health checks.
They return no runtime, route, or credential information.

Required runtime configuration:

```env
BLAME_PREVIEW_EDGE_CONTROL_ORIGIN=https://api.example.com
BLAME_PREVIEW_EDGE_CONTROL_TOKEN=<shared API/Edge secret>
BLAME_PREVIEW_EDGE_COOKIE_SECRET=<independent random secret>
BLAME_PREVIEW_CAPABILITY_PRIVATE_KEY=<Ed25519 private key PEM>
BLAME_PREVIEW_HOSTNAME_SUFFIX=preview.example.com
HOST=0.0.0.0
PORT=8080
```

For Dokploy, create an **Application** using the Dockerfile build type and set:

- Build path: `/`
- Dockerfile path: `packages/preview-edge/Dockerfile`
- Docker context path: `.`
- Docker build stage: `production`
- Domain host: `*.preview.example.com`
- Domain path: `/`
- Container port: `8080`
- HTTPS: enabled with a certificate valid for `*.preview.example.com`

Do not publish port 8080 through Dokploy's Advanced Ports panel. The domain must
reach it only through Traefik. Do not enable Basic Auth or Forward Auth: Preview
Edge already performs ticket exchange and endpoint-scoped session authorization.

Traefik v3 accepts ``Host(`*.preview.example.com`)`` for a single-label wildcard,
preserves the original host, supports WebSocket upgrades without extra headers,
and flushes recognized streaming responses immediately. Do not attach a
buffering middleware. A wildcard TLS certificate requires an ACME DNS-01
resolver or an imported custom certificate; HTTP-01 cannot issue it.

The DNS zone must resolve both the suffix and its wildcard to the Dokploy ingress:

```dns
preview.example.com    A       <DOKPLOY_PUBLIC_IP>
*.preview.example.com  CNAME   preview.example.com.
```

The root wildcard `*.example.com` is not sufficient for TLS: it does not cover
route hosts such as `opaque-id.preview.example.com`.
