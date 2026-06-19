import assert from "node:assert/strict";
import test from "node:test";

import { fallbackCommitSubject } from "./commit-message.js";

test("uses the backlog title for fallback commit subjects", () => {
  assert.equal(
    fallbackCommitSubject("Ajouter une authentification GitHub !", [
      "src/auth/github.ts",
    ]),
    "ajouter une authentification GitHub",
  );
});

test("keeps title fallback more specific than file category fallbacks", () => {
  assert.equal(
    fallbackCommitSubject("Cover checkout discounts", [
      "src/checkout/discounts.test.ts",
    ]),
    "cover checkout discounts",
  );
});

test("uses file category fallbacks only without a backlog title", () => {
  assert.equal(
    fallbackCommitSubject("", ["src/checkout/discounts.test.ts"]),
    "cover backlog item",
  );
});
