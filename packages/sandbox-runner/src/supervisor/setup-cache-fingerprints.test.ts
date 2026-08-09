import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setupCacheFingerprintMatches,
  writeSetupCacheFingerprint,
} from "./setup-cache-fingerprints.js";

test("requires every restored cache volume to contain the setup marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-setup-cache-test-"));
  const first = join(root, "first");
  const second = join(root, "second");
  try {
    await mkdir(first);
    await mkdir(second);
    assert.equal(
      await setupCacheFingerprintMatches(
        [first, second],
        "dependencies",
        "fingerprint-1",
      ),
      false,
    );

    await writeSetupCacheFingerprint(
      [first, second],
      "dependencies",
      "fingerprint-1",
    );
    assert.equal(
      await setupCacheFingerprintMatches(
        [first, second],
        "dependencies",
        "fingerprint-1",
      ),
      true,
    );
    assert.equal(
      await setupCacheFingerprintMatches(
        [first, second],
        "dependencies",
        "fingerprint-2",
      ),
      false,
    );

    await rm(join(second, ".blame-setup-fingerprints.json"));
    assert.equal(
      await setupCacheFingerprintMatches(
        [first, second],
        "dependencies",
        "fingerprint-1",
      ),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recovers a corrupt marker and retains fingerprints for other tasks", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-setup-cache-corrupt-"));
  try {
    await writeFile(join(root, ".blame-setup-fingerprints.json"), "not-json");
    await writeSetupCacheFingerprint([root], "frontend", "frontend-1");
    await writeSetupCacheFingerprint([root], "backend", "backend-1");

    assert.equal(
      await setupCacheFingerprintMatches([root], "frontend", "frontend-1"),
      true,
    );
    assert.equal(
      await setupCacheFingerprintMatches([root], "backend", "backend-1"),
      true,
    );
    assert.equal(
      await setupCacheFingerprintMatches([], "frontend", "frontend-1"),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
