import assert from "node:assert/strict";
import test from "node:test";
import type { PreviewManifest } from "@blame/preview-contract";

import {
  detectedStackUsesNext,
  packageJsonUsesNext,
} from "./project-stack-detection.ts";

test("uses the persisted detected stack for Next projects", () => {
  const manifest = {
    project: { detectedStack: ["Node", "Next.js"] },
  } as PreviewManifest;

  assert.equal(detectedStackUsesNext(manifest), true);
  assert.equal(
    detectedStackUsesNext({
      project: { detectedStack: ["Python"] },
    } as PreviewManifest),
    false,
  );
  assert.equal(detectedStackUsesNext(undefined), undefined);
});

test("detects Next in every package dependency section", () => {
  assert.equal(
    packageJsonUsesNext(JSON.stringify({ peerDependencies: { next: "15" } })),
    true,
  );
  assert.equal(
    packageJsonUsesNext(JSON.stringify({ dependencies: { nextcloud: "1" } })),
    false,
  );
  assert.equal(packageJsonUsesNext("invalid"), false);
});
