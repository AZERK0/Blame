import type { CoreSessionConfig } from "@cline/sdk";
import {
  ConversationMemoryStore,
  type RuntimeContinuity,
} from "./conversation-memory.js";

type AgentHooks = NonNullable<CoreSessionConfig["hooks"]>;
type BeforeModelContext = Parameters<NonNullable<AgentHooks["beforeModel"]>>[0];
type AgentMessages = BeforeModelContext["request"]["messages"];
type AgentMessage = AgentMessages[number];
type AgentMessagePart = AgentMessage["content"][number];

export function continuityProjectionHooks(
  memory: ConversationMemoryStore,
): AgentHooks {
  let previousFootprint: TranscriptFootprint | undefined;
  return {
    async beforeModel(context: BeforeModelContext) {
      const footprint = transcriptFootprint(context.request.messages);
      await memory.checkpoint();
      if (transcriptCompacted(previousFootprint, footprint)) {
        await memory.rotate("model_compaction");
      }
      previousFootprint = footprint;
      const continuity = await memory.runtimeContinuity();
      return {
        messages: projectContinuity(
          context.request.messages,
          renderRuntimeContinuity(continuity),
          continuity.activeRequest,
        ),
      };
    },
  };
}

type TranscriptFootprint = { bytes: number; messages: number };

function transcriptFootprint(messages: AgentMessages): TranscriptFootprint {
  return {
    bytes: Buffer.byteLength(JSON.stringify(messages), "utf8"),
    messages: messages.length,
  };
}

function transcriptCompacted(
  previous: TranscriptFootprint | undefined,
  current: TranscriptFootprint,
) {
  if (!previous) return false;
  return (
    current.messages < previous.messages ||
    (previous.bytes >= 4_096 && current.bytes < previous.bytes * 0.7)
  );
}

export function renderRuntimeContinuity(value: RuntimeContinuity) {
  return [
    "<blame_continuity>",
    section("Active request", [value.activeRequest]),
    section("Active constraints", value.constraints),
    section("Confirmed decisions", value.decisions),
    section("Runtime observations", value.observations),
    section("Inspected files at source revision", value.inspectedFiles),
    section("Verified symbols from inspected source", value.verifiedSymbols),
    section("Modified files", value.modifiedFiles),
    section("Validation", [value.validation]),
    section("Next action", [value.nextAction]),
    "</blame_continuity>",
  ]
    .filter(Boolean)
    .join("\n");
}

function projectContinuity(
  messages: AgentMessages,
  block: string,
  activeRequest: string,
) {
  const activeRequestIndex = messages.findLastIndex((message: AgentMessage) =>
    messageContainsRequest(message, activeRequest),
  );
  const userIndex =
    activeRequestIndex >= 0
      ? activeRequestIndex
      : messages.findLastIndex(({ role }: AgentMessage) => role === "user");
  if (userIndex < 0) return messages;
  return messages.map((message: AgentMessage, index: number) => {
    if (index !== userIndex) return message;
    const attachments = message.content.filter(
      ({ type }: AgentMessagePart) => type !== "text",
    );
    return {
      ...message,
      content: [{ type: "text" as const, text: block }, ...attachments],
      metadata: {
        ...message.metadata,
        blameContinuityProjection: true,
      },
    };
  });
}

function messageContainsRequest(message: AgentMessage, activeRequest: string) {
  if (message.role !== "user") return false;
  return message.content.some(
    (part: AgentMessagePart) =>
      part.type === "text" && part.text.trim() === activeRequest.trim(),
  );
}

function section(label: string, values: string[]) {
  const selected = values.map((value) => value.trim()).filter(Boolean);
  if (!selected.length) return "";
  return `${label}:\n${selected.map((value) => `- ${value}`).join("\n")}`;
}
