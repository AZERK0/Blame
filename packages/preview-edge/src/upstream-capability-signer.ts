import { createPrivateKey, randomBytes, sign } from "node:crypto";
import type { ResolvedPreviewRoute } from "./preview-route-resolver.js";

export class UpstreamCapabilitySigner {
  private readonly key;

  constructor(privateKeyPem: string) {
    this.key = createPrivateKey(privateKeyPem);
    if (this.key.asymmetricKeyType !== "ed25519") {
      throw new Error("Preview capability key must be Ed25519.");
    }
  }

  sign(route: ResolvedPreviewRoute, ttlSeconds = 30) {
    const now = Math.floor(Date.now() / 1000);
    const header = encode({ alg: "EdDSA", typ: "JWT" });
    const payload = encode({
      iss: "blame-preview-edge",
      aud: "blame-sandbox-gateway",
      sessionId: route.sessionId,
      endpointId: route.endpointId,
      generation: route.generation,
      iat: now,
      exp: now + ttlSeconds,
      nonce: randomBytes(16).toString("base64url"),
    });
    const signature = sign(null, Buffer.from(`${header}.${payload}`), this.key).toString("base64url");
    return `${header}.${payload}.${signature}`;
  }
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
