import { errorAttributes, opaqueIdentifier } from "@blame/telemetry";

const maximumArgumentTypes = 8;
const maximumMessageLengths = 4;

export function liveLogAttributes(data: unknown[]) {
  const messages = data.flatMap(logMessage).slice(0, maximumMessageLengths);
  const error = data.find((value) => value instanceof Error);
  return {
    "blame.log.argument_count": data.length,
    "blame.log.argument_types": data
      .slice(0, maximumArgumentTypes)
      .map(logValueType),
    ...messageMetadata(messages),
    ...(error ? errorAttributes(error) : {}),
  };
}

export function rendererLogAttributes(
  message: string,
  line: number,
  source: string,
) {
  return {
    "blame.log.argument_count": 1,
    ...messageMetadata([message]),
    "blame.log.source_id": source ? opaqueIdentifier(source) : undefined,
    "code.line.number": line,
  };
}

function messageMetadata(messages: string[]) {
  if (messages.length === 0) return {};
  return {
    "blame.log.message_lengths": messages.map((message) => message.length),
  };
}

function logMessage(value: unknown) {
  if (value instanceof Error) return [value.message];
  if (typeof value === "string") return [value];
  return [];
}

function logValueType(value: unknown) {
  if (value instanceof Error) return "error";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
