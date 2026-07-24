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

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  })
}
