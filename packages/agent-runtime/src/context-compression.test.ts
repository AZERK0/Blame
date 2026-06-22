import assert from "node:assert/strict";
import test from "node:test";

import type { AgentPlugin, Message } from "@cline/sdk";

import {
  contextCompressionConfig,
  contextCompressionExtensions,
} from "./context-compression.js";

type AgentPluginSetupApi = Parameters<NonNullable<AgentPlugin["setup"]>>[0];
type AgentMessageBuilder = Parameters<
  AgentPluginSetupApi["registerMessageBuilder"]
>[0];

test("keeps Cline compaction as the default context mode", () => {
  const config = contextCompressionConfig({}, undefined);

  assert.equal(config.enabled, true);
  assert.equal(config.strategy, "basic");
  assert.equal(config.compact, undefined);
});

test("disables compaction for off context mode", () => {
  const config = contextCompressionConfig({}, "off");

  assert.equal(config.enabled, false);
  assert.equal(config.compact, undefined);
});

test("disables late Cline compaction for Headroom context mode", () => {
  const config = contextCompressionConfig({}, "headroom");

  assert.equal(config.enabled, false);
  assert.equal(config.strategy, undefined);
  assert.equal(config.compact, undefined);
});

test("adds Headroom as a provider-bound message builder", async () => {
  const logs: { message: string; payload?: unknown }[] = [];
  const builders = await registeredHeadroomBuilders(logs);

  assert.equal(builders.length, 1);
  const messages: Message[] = [{ role: "user", content: "small context" }];
  const result = await builders[0]?.build(messages);

  assert.equal(result, messages);
  assert.equal(logs[0]?.message, "headroom provider compression skipped");
});

test("keeps raw tool result arrays safe during Headroom estimation", async () => {
  const logs: { message: string; payload?: unknown }[] = [];
  const builders = await registeredHeadroomBuilders(logs);
  const messages = [
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "run_commands",
          input: { commands: ["find ."] },
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool_1",
          name: "run_commands",
          content: [{ query: "find .", result: "package.json", success: true }],
        },
      ],
    },
  ] as unknown as Message[];

  const result = await builders[0]?.build(messages);

  assert.equal(result, messages);
  assert.equal(logs[0]?.message, "headroom provider compression skipped");
});

test("does not add provider-bound extensions outside Headroom mode", () => {
  assert.equal(contextCompressionExtensions({}, undefined), undefined);
  assert.equal(contextCompressionExtensions({}, "cline"), undefined);
  assert.equal(contextCompressionExtensions({}, "off"), undefined);
});

async function registeredHeadroomBuilders(
  logs: { message: string; payload?: unknown }[],
) {
  const extensions = contextCompressionExtensions(
    { compactionMaxInputTokens: 100_000 },
    "headroom",
    {
      logger: (message, payload) => {
        logs.push({ message, payload });
      },
      modelId: "glm-5.1",
    },
  );
  const builders: AgentMessageBuilder[] = [];

  assert.equal(extensions?.length, 1);
  await extensions?.[0]?.setup?.(pluginSetupApi(builders), {});
  return builders;
}

function pluginSetupApi(builders: AgentMessageBuilder[]): AgentPluginSetupApi {
  return {
    registerCommand: () => undefined,
    registerMessageBuilder: (builder: AgentMessageBuilder) => {
      builders.push(builder);
    },
    registerProvider: () => undefined,
    registerRule: () => undefined,
    registerTool: () => undefined,
    registerAutomationEventType: () => undefined,
  };
}
