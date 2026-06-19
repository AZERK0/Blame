import assert from "node:assert/strict"
import test from "node:test"

import { commandWithNextWebpackFallback } from "./next-webpack-fallback.js"

test("adds webpack to direct Next dev commands", () => {
  assert.equal(commandWithNextWebpackFallback("next dev"), "next dev --webpack")
})

test("adds webpack to pnpm dev commands without argument separators", () => {
  assert.equal(
    commandWithNextWebpackFallback("corepack pnpm dev"),
    "corepack pnpm dev --webpack",
  )
})

test("adds webpack to npm dev commands with an argument separator", () => {
  assert.equal(
    commandWithNextWebpackFallback("npm run dev"),
    "npm run dev -- --webpack",
  )
})

test("rewrites quoted compose commands before the closing quote", () => {
  const command =
    "command: \"sh -lc '(corepack enable 2>/dev/null || true) && corepack prepare pnpm@10.33.2 --activate && corepack pnpm dev'\""

  assert.equal(
    commandWithNextWebpackFallback(command),
    "command: \"sh -lc '(corepack enable 2>/dev/null || true) && corepack prepare pnpm@10.33.2 --activate && corepack pnpm dev --webpack'\"",
  )
})

test("keeps commands with an explicit bundler unchanged", () => {
  assert.equal(
    commandWithNextWebpackFallback("next dev --turbopack"),
    "next dev --turbopack",
  )
})
