import assert from "node:assert/strict";
import test from "node:test";
import type { SpanExporter } from "@opentelemetry/sdk-trace";
import { GatedSpanExporter } from "./gated-exporters.js";

test("drops batches until authenticated export is ready", async () => {
  let ready = false;
  let exported = 0;
  const delegate: SpanExporter = {
    export(_spans, callback) {
      exported += 1;
      callback({ code: 0 });
    },
    async shutdown() {},
  };
  const exporter = new GatedSpanExporter(delegate, () => ready);

  await exportBatch(exporter);
  assert.equal(exported, 0);

  ready = true;
  await exportBatch(exporter);
  assert.equal(exported, 1);
});

function exportBatch(exporter: SpanExporter) {
  return new Promise<void>((resolve) => {
    exporter.export([], () => resolve());
  });
}
