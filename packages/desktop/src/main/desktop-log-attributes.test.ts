import assert from "node:assert/strict";
import test from "node:test";
import { opaqueIdentifier } from "@blame/telemetry";
import {
  liveLogAttributes,
  rendererLogAttributes,
} from "./desktop-log-attributes.ts";

test("replaces arbitrary live messages with bounded metadata", () => {
  const privateMessage = "private repository source code";
  const attributes = liveLogAttributes([
    privateMessage,
    { privateMessage },
    42,
  ]);

  assert.equal(JSON.stringify(attributes).includes(privateMessage), false);
  assert.deepEqual(attributes["blame.log.argument_types"], [
    "string",
    "object",
    "number",
  ]);
  assert.deepEqual(attributes["blame.log.message_lengths"], [
    privateMessage.length,
  ]);
});

test("keeps Error taxonomy without the original message", () => {
  const attributes = liveLogAttributes([
    new Error("provider rejected Bearer abcdefghijklmnop"),
  ]);

  assert.equal(attributes["error.type"], "Error");
  assert.equal(attributes["exception.type"], "Error");
  assert.equal(attributes["exception.message"], undefined);
  assert.equal(JSON.stringify(attributes).includes("provider rejected"), false);
  assert.equal(JSON.stringify(attributes).includes("abcdefghijklmnop"), false);
});

test("does not expose renderer console text or source paths", () => {
  const message = "customer prompt with private code";
  const source = "/private/repository/src/page.tsx";
  const attributes = rendererLogAttributes(message, 41, source);

  assert.equal(JSON.stringify(attributes).includes(message), false);
  assert.equal(JSON.stringify(attributes).includes(source), false);
  assert.equal(attributes["blame.log.source_id"], opaqueIdentifier(source));
  assert.equal(attributes["code.line.number"], 41);
});
