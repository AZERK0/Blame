import assert from "node:assert/strict"
import test from "node:test"

import {
  backendOptions,
  defaultNewProjectConfiguration,
  normalizeNewProjectConfiguration,
  ormOptions,
  packageManagerOptions,
  recommendedUiLibrary,
  requiresTailwind,
  uiLibraryOptions,
} from "./new-project-options.ts"

test("forces Tailwind for shadcn and DaisyUI", () => {
  assert.equal(requiresTailwind("shadcn"), true)
  assert.equal(requiresTailwind("shadcn-svelte"), true)
  assert.equal(requiresTailwind("daisyui"), true)

  const configuration = normalizeNewProjectConfiguration({
    ...defaultNewProjectConfiguration,
    styling: "sass",
    uiLibrary: "daisyui",
  })

  assert.equal(configuration.styling, "tailwind")
})

test("disables UI options when no frontend is selected", () => {
  const options = uiLibraryOptions("none")
  const configuration = normalizeNewProjectConfiguration({
    ...defaultNewProjectConfiguration,
    frontend: "none",
    styling: "tailwind",
    uiLibrary: "shadcn",
  })

  assert.deepEqual(options.map((option) => option.value), ["none"])
  assert.equal(configuration.uiLibrary, "none")
  assert.equal(configuration.styling, "none")
})

test("filters backend dependent ORM and runtime choices", () => {
  assert.deepEqual(
    packageManagerOptions("fastapi").map((option) => option.value),
    ["uv", "poetry", "pip"]
  )
  assert.deepEqual(
    ormOptions("fastapi", "postgresql").map((option) => option.value),
    ["sqlalchemy", "sqlmodel", "none"]
  )
  assert.equal(
    ormOptions("hono", "mongodb").find((option) => option.value === "drizzle")
      ?.disabled,
    true
  )
})

test("returns default recommendations per frontend", () => {
  assert.equal(recommendedUiLibrary("next"), "shadcn")
  assert.equal(recommendedUiLibrary("react-vite"), "shadcn")
  assert.equal(recommendedUiLibrary("nuxt"), "nuxt-ui")
  assert.equal(recommendedUiLibrary("vue-vite"), "primevue")
  assert.equal(recommendedUiLibrary("sveltekit"), "shadcn-svelte")
})

test("limits framework specific backends", () => {
  assert.deepEqual(
    backendOptions("next").map((option) => option.value),
    ["next-api", "nest", "hono", "none"]
  )
  assert.deepEqual(
    backendOptions("nuxt").map((option) => option.value),
    ["nitro", "nest", "fastapi", "none"]
  )
})
