import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyPreviewCapability } from "./preview-auth.js";

test("accepts only short endpoint-scoped Ed25519 capabilities", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "EdDSA", typ: "JWT" });
  const payload = encode({
    iss: "blame-preview-edge",
    aud: "blame-sandbox-gateway",
    sessionId: "session-a",
    endpointId: "frontend",
    generation: 3,
    iat: now,
    exp: now + 30,
    nonce: "abcdefghijklmnop",
  });
  const signature = sign(null, Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  const token = `${header}.${payload}.${signature}`;
  const key = publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.equal(
    verifyPreviewCapability({
      token,
      publicKeyPem: key,
      sessionId: "session-a",
      endpointId: "frontend",
      generation: 3,
      now,
    })?.endpointId,
    "frontend",
  );
  assert.equal(
    verifyPreviewCapability({
      token,
      publicKeyPem: key,
      sessionId: "session-b",
      endpointId: "frontend",
      generation: 3,
      now,
    }),
    null,
  );
});

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
