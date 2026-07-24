import assert from "node:assert/strict"
import test from "node:test"
import {
  desktopAuthCallback,
  desktopDeepLink,
  desktopProtocolClientArguments,
} from "./desktop-auth-deep-link.ts"

test("registers the development Electron entry point with the protocol", () => {
  const argumentsForProtocol = desktopProtocolClientArguments(
    false,
    "/opt/electron",
    ["/opt/electron", "/workspace/packages/desktop"]
  )

  assert.deepEqual(argumentsForProtocol, [
    "/opt/electron",
    ["/workspace/packages/desktop"],
  ])
})

test("uses packaged protocol registration without development arguments", () => {
  assert.deepEqual(
    desktopProtocolClientArguments(true, "/opt/blame", ["/opt/blame"]),
    []
  )
})

test("extracts the callback from packaged launch arguments", () => {
  const callback = `blame://auth/callback?code=${"a".repeat(32)}`

  assert.equal(desktopDeepLink(["/opt/blame", `--url="${callback}"`]), callback)
})

test("ignores arguments without a Blame protocol URL", () => {
  assert.equal(desktopDeepLink(["/opt/blame", "--disable-gpu"]), undefined)
})

test("accepts a single valid authentication code", () => {
  const code = "a".repeat(32)
  assert.deepEqual(desktopAuthCallback(`blame://auth/callback?code=${code}`), {
    code,
  })
})

test("rejects authentication callbacks with extra parameters", () => {
  const code = "a".repeat(32)
  assert.equal(
    desktopAuthCallback(`blame://auth/callback?code=${code}&extra=true`),
    undefined
  )
})
