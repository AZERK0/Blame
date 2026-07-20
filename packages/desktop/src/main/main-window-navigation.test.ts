import assert from "node:assert/strict"
import test from "node:test"

import { createMainWindowNavigationGuard } from "./main-window-navigation.ts"

test("allows only the configured renderer origin in development", () => {
  const openedUrls: string[] = []
  const guard = createGuard(openedUrls, "http://localhost:5173/app")
  const trustedEvent = navigationEvent("http://localhost:5173/chat?id=1")
  const externalEvent = navigationEvent("https://example.com/docs")

  guard.handleNavigation(trustedEvent)
  guard.handleNavigation(externalEvent)

  assert.equal(trustedEvent.prevented, false)
  assert.equal(externalEvent.prevented, true)
  assert.deepEqual(openedUrls, ["https://example.com/docs"])
})

test("allows only the packaged renderer file in production", () => {
  const openedUrls: string[] = []
  const guard = createGuard(openedUrls)
  const trustedEvent = navigationEvent(
    "file:///opt/Blame/resources/app.asar/out/renderer/index.html?route=chat#latest"
  )
  const localFileEvent = navigationEvent("file:///tmp/untrusted.html")

  guard.handleNavigation(trustedEvent)
  guard.handleNavigation(localFileEvent)

  assert.equal(trustedEvent.prevented, false)
  assert.equal(localFileEvent.prevented, true)
  assert.deepEqual(openedUrls, [])
})

test("blocks cross-origin redirects without launching another application", () => {
  const openedUrls: string[] = []
  const guard = createGuard(openedUrls, "http://localhost:5173")
  const redirectEvent = navigationEvent("https://example.com/redirected")

  guard.handleRedirect(redirectEvent)

  assert.equal(redirectEvent.prevented, true)
  assert.deepEqual(openedUrls, [])
})

test("denies new Electron windows and opens safe links externally", () => {
  const openedUrls: string[] = []
  const guard = createGuard(openedUrls)

  assert.deepEqual(
    guard.handleWindowOpen({ url: "https://example.com/path" }),
    {
      action: "deny",
    }
  )
  assert.deepEqual(
    guard.handleWindowOpen({ url: "file:///tmp/untrusted.html" }),
    {
      action: "deny",
    }
  )
  assert.deepEqual(openedUrls, ["https://example.com/path"])
})

function createGuard(openedUrls: string[], rendererUrl?: string) {
  return createMainWindowNavigationGuard({
    openExternal: (url) => openedUrls.push(url),
    rendererFile: "/opt/Blame/resources/app.asar/out/renderer/index.html",
    rendererUrl,
  })
}

function navigationEvent(url: string) {
  return {
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
    url,
  }
}
