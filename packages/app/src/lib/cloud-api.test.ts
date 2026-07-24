import assert from "node:assert/strict"
import test from "node:test"
import { createCloudApi } from "./cloud-api.ts"

const originalFetch = globalThis.fetch

test.afterEach(() => {
  globalThis.fetch = originalFetch
})

test("starts an email OTP challenge after a valid password", async () => {
  const requests: Array<{ init?: RequestInit; url: string }> = []
  globalThis.fetch = async (input, init) => {
    requests.push({ init, url: String(input) })
    if (requests.length === 1) {
      return jsonResponse({
        twoFactorRedirect: true,
        twoFactorMethods: ["otp"],
      })
    }
    return jsonResponse({ status: true })
  }

  const result = await createCloudApi({ url: "https://api.blame.test" }).login({
    email: "ada@example.com",
    password: "correct horse battery staple",
  })

  assert.equal(result, "two-factor")
  assert.deepEqual(
    requests.map((request) => request.url),
    [
      "https://api.blame.test/auth/sign-in/email",
      "https://api.blame.test/auth/two-factor/send-otp",
    ]
  )
  assert.ok(requests.every((request) => request.init?.credentials === "include"))
})

test("creates a cloud session after email OTP verification", async () => {
  globalThis.fetch = async () =>
    jsonResponse({
      token: "session-token",
      user: {
        id: "user-id",
        name: "Ada Lovelace",
        email: "ada@example.com",
        createdAt: "2026-07-24T00:00:00.000Z",
        updatedAt: "2026-07-24T00:00:00.000Z",
      },
    })

  const session = await createCloudApi({
    url: "https://api.blame.test",
  }).verifyEmailTwoFactor("123456")

  assert.equal(session.token, "session-token")
  assert.equal(session.user.initials, "AL")
})

test("starts social sign-in with a device authorization URL", async () => {
  let request: { init?: RequestInit; url: string } | undefined
  globalThis.fetch = async (input, init) => {
    request = { init, url: String(input) }
    return jsonResponse({
      device_code: "secure-device-code",
      expires_in: 600,
      interval: 5,
      user_code: "ABCD2345",
      verification_uri: "https://blame.so/auth/desktop",
      verification_uri_complete:
        "https://blame.so/auth/desktop?user_code=ABCD2345",
    })
  }

  const authorization = await createCloudApi({
    url: "https://api.blame.test",
  }).socialLogin("google")

  assert.equal(request?.url, "https://api.blame.test/auth/device/code")
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    client_id: "blame-desktop",
    scope: "openid profile email",
  })
  assert.equal(
    authorization.verificationUrl,
    "https://blame.so/auth/desktop?user_code=ABCD2345&provider=google"
  )
})

test("polls device authorization until its one-time token is ready", async () => {
  let requestCount = 0
  globalThis.fetch = async () => {
    requestCount += 1
    if (requestCount === 1) {
      return jsonResponse(
        {
          error: "authorization_pending",
          error_description: "Authorization is pending",
        },
        { status: 400 }
      )
    }
    return jsonResponse({ access_token: "raw-session-token" })
  }
  const api = createCloudApi({ url: "https://api.blame.test" })

  assert.deepEqual(await api.pollSocialLogin("secure-device-code"), {
    status: "pending",
  })
  assert.deepEqual(await api.pollSocialLogin("secure-device-code"), {
    accessToken: "raw-session-token",
    status: "authenticated",
  })
})

function jsonResponse(
  body: unknown,
  init?: { headers?: HeadersInit; status?: number }
) {
  const headers = new Headers(init?.headers)
  headers.set("content-type", "application/json")
  return new Response(JSON.stringify(body), {
    headers,
    status: init?.status ?? 200,
  })
}
