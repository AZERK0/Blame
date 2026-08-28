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
  return {
    async beforeModel(context: BeforeModelContext) {
      await memory.checkpoint();
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

export function renderRuntimeContinuity(value: RuntimeContinuity) {
  return [
    "<blame_continuity>",
    section("Active request", [value.activeRequest]),
    section("Active constraints", value.constraints),
    section("Confirmed decisions", value.decisions),
    section("Inspected files at source revision", value.inspectedFiles),
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
