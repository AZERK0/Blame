import assert from "node:assert/strict";
import test from "node:test";
import { PreviewSessionAuth } from "./preview-session-auth.js";

test("issues scoped HttpOnly preview cookies and rejects tampering", () => {
  const auth = new PreviewSessionAuth("a-secure-cookie-secret-with-more-than-32-bytes");
  const cookie = auth.issue({
    sessionId: "session-a",
    endpointId: "frontend",
    ownerUserId: "user-a",
  });
  assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
  const value = cookie.split(";", 1)[0];
  const session = auth.authenticate({ cookie: value });
  assert.equal(session?.sessionId, "session-a");
  assert.equal(session?.endpointId, "frontend");
  assert.ok((session?.exp ?? 0) > Math.floor(Date.now() / 1000));
  assert.equal(auth.authenticate({ cookie: `${value}x` }), null);
});
