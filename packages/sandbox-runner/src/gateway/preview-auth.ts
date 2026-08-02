import { createPublicKey, verify } from "node:crypto";

export type PreviewCapabilityClaims = {
  iss: "blame-preview-edge";
  aud: "blame-sandbox-gateway";
  sessionId: string;
  endpointId: string;
  generation: number;
  exp: number;
  iat: number;
  nonce: string;
};

export function verifyPreviewCapability(input: {
  token: string | undefined;
  publicKeyPem: string;
  sessionId: string;
  endpointId: string;
  generation: number;
  now?: number;
}): PreviewCapabilityClaims | null {
  try {
    if (!input.token || input.token.length > 4096) return null;
    const [encodedHeader, encodedPayload, encodedSignature, extra] = input.token.split(".");
    if (!encodedHeader || !encodedPayload || !encodedSignature || extra) return null;
    const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
    if (header.alg !== "EdDSA" || header.typ !== "JWT") return null;
    const claims = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as PreviewCapabilityClaims;
    const signature = Buffer.from(encodedSignature, "base64url");
    const valid = verify(
      null,
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      createPublicKey(input.publicKeyPem),
      signature,
    );
    const now = input.now ?? Math.floor(Date.now() / 1000);
    if (
      !valid ||
      claims.iss !== "blame-preview-edge" ||
      claims.aud !== "blame-sandbox-gateway" ||
      claims.sessionId !== input.sessionId ||
      claims.endpointId !== input.endpointId ||
      claims.generation !== input.generation ||
      !Number.isSafeInteger(claims.exp) ||
      !Number.isSafeInteger(claims.iat) ||
      claims.exp <= now ||
      claims.iat > now + 5 ||
      claims.exp - claims.iat > 120 ||
      typeof claims.nonce !== "string" ||
      claims.nonce.length < 16
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}
