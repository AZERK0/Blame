import assert from "node:assert/strict";
import test from "node:test";
import {
  CloudAuthCookieJar,
  sendCloudAuthRequest,
} from "./cloud-auth-request.ts";

test("sends packaged authentication through the official API origin", async () => {
  const requests: Array<{ headers: Headers; url: string }> = [];
  const cookieJar = new CloudAuthCookieJar();
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ headers: new Headers(init?.headers), url: String(input) });
    return new Response("{}", {
      headers: {
        "set-auth-token": "session-token",
        "set-cookie": "two_factor=challenge; Path=/; HttpOnly; Secure",
      },
    });
  };
  const input = authenticationRequest(
    "https://api.blame.so/api/v1/auth/sign-in/email",
  );

  const first = await sendCloudAuthRequest(input, {
    cookieJar,
    fetcher,
    packaged: true,
  });
  await sendCloudAuthRequest(input, { cookieJar, fetcher, packaged: true });

  assert.equal(requests[0]?.headers.get("origin"), "https://api.blame.so");
  assert.equal(requests[1]?.headers.get("cookie"), "two_factor=challenge");
  assert.equal(first.headers["set-auth-token"], "session-token");
  assert.equal(first.headers["set-cookie"], undefined);
});

test("rejects non-official authentication targets in packaged builds", async () => {
  const request = authenticationRequest(
    "https://attacker.example/auth/sign-in/email",
  );

  await assert.rejects(
    sendCloudAuthRequest(request, {
      cookieJar: new CloudAuthCookieJar(),
      fetcher: async () => new Response(),
      packaged: true,
    }),
    /target is not allowed/,
  );
});

function authenticationRequest(url: string) {
  return {
    body: JSON.stringify({
      email: "ada@example.com",
      password: "correct horse battery staple",
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    url,
  };
}
