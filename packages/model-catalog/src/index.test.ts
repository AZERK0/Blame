import assert from "node:assert/strict";
import test from "node:test";
import { ModelInfoSchema } from "@cline/shared";
import {
  missingProviderModels,
  supplementalModels,
  supplementalModelStatus,
  withSupplementalModels,
  type SupplementalModel,
} from "./index.js";

const entry: SupplementalModel = {
  providerId: "fixture",
  model: { id: "future-model", name: "Temporary name", contextWindow: 1234 },
  source: "https://example.com/models/future-model",
  verifiedAt: "2026-09-10",
};

test("additions are isolated by provider and do not change official models", () => {
  const official = { existing: { id: "existing" } };
  const merged = withSupplementalModels("fixture", official, [entry]);
  assert.deepEqual(Object.keys(merged).sort(), ["existing", "future-model"]);
  assert.equal(merged.existing, official.existing);
  assert.deepEqual(Object.keys(official), ["existing"]);
  assert.deepEqual(
    withSupplementalModels("another-provider", official, [entry]),
    official,
  );
  merged[entry.model.id].name = "Mutated";
  assert.equal(entry.model.name, "Temporary name");
});

test("official availability retires the entire fallback even for deprecated models", () => {
  const official = {
    [entry.model.id]: { id: entry.model.id, status: "deprecated" as const },
  };
  assert.equal(supplementalModelStatus(entry, official), "official");
  assert.deepEqual(missingProviderModels("fixture", official, [entry]), {});
  assert.deepEqual(
    withSupplementalModels("fixture", official, [entry]),
    official,
  );
  assert.equal(
    withSupplementalModels("fixture", official, [entry])[entry.model.id]
      .contextWindow,
    undefined,
  );
  // Provider-specific: availability elsewhere must not retire this entry.
  assert.equal(supplementalModelStatus(entry, {}), "active");
});

test("an entry can be disabled without removing its source or history", () => {
  const disabled = { ...entry, enabled: false };
  assert.equal(supplementalModelStatus(disabled, {}), "disabled");
  assert.deepEqual(withSupplementalModels("fixture", {}, [disabled]), {});
});

test("ambiguous duplicate additions fail rather than depending on import order", () => {
  assert.throws(
    () => missingProviderModels("fixture", {}, [entry, entry]),
    /Duplicate/,
  );
});

test("the shipped catalog contains valid, documented and unique Cline model entries", () => {
  const pairs = new Set<string>();
  for (const entry of supplementalModels) {
    ModelInfoSchema.parse(entry.model);
    assert.ok(entry.source.startsWith("https://"));
    assert.match(entry.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
    const key = `${entry.providerId}/${entry.model.id}`;
    assert.ok(!pairs.has(key), key);
    pairs.add(key);
  }
});
