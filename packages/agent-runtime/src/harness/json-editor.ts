import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

export type JsonOperation =
  | { type: "set"; path: Array<string | number>; value: unknown }
  | { type: "delete"; path: Array<string | number> }
  | { type: "merge"; path: Array<string | number>; value: object }
  | { type: "append"; path: Array<string | number>; value: unknown };

export function editJsonContent(source: string, operations: JsonOperation[]) {
  let content = source;
  for (const operation of operations)
    content = applyJsonOperation(content, operation);
  assertValidJsonc(content);
  return content;
}

export function jsoncErrors(source: string) {
  const errors: ParseError[] = [];
  parse(source, errors, { allowTrailingComma: true, disallowComments: false });
  return errors;
}

export function assertValidJsonc(source: string) {
  const errors = jsoncErrors(source);
  if (errors.length)
    throw new Error(
      `JSON validation failed with ${errors.length} syntax error(s).`,
    );
}

function applyJsonOperation(source: string, operation: JsonOperation) {
  if (operation.type === "merge") return mergeJsonValue(source, operation);
  if (operation.type === "append") return appendJsonValue(source, operation);
  const value = operation.type === "delete" ? undefined : operation.value;
  return modifyJson(source, operation.path, value, false);
}

function mergeJsonValue(
  source: string,
  operation: Extract<JsonOperation, { type: "merge" }>,
) {
  const current = valueAtPath(source, operation.path);
  if (!isRecord(current))
    throw new Error("JSON merge target must be an object.");
  return modifyJson(
    source,
    operation.path,
    { ...current, ...operation.value },
    false,
  );
}

function appendJsonValue(
  source: string,
  operation: Extract<JsonOperation, { type: "append" }>,
) {
  const current = valueAtPath(source, operation.path);
  if (!Array.isArray(current))
    throw new Error("JSON append target must be an array.");
  return modifyJson(
    source,
    [...operation.path, current.length],
    operation.value,
    true,
  );
}

function modifyJson(
  source: string,
  path: Array<string | number>,
  value: unknown,
  isArrayInsertion: boolean,
) {
  return applyEdits(
    source,
    modify(source, path, value, {
      formattingOptions: formattingOptions(source),
      isArrayInsertion,
    }),
  );
}

function valueAtPath(source: string, path: Array<string | number>) {
  let value: unknown = parse(source, [], {
    allowTrailingComma: true,
    disallowComments: false,
  });
  for (const segment of path) {
    if (Array.isArray(value) && typeof segment === "number")
      value = value[segment];
    else if (isRecord(value) && typeof segment === "string")
      value = value[segment];
    else return undefined;
  }
  return value;
}

function formattingOptions(source: string) {
  const indentation = source.match(/\n([ \t]+)\S/u)?.[1] ?? "  ";
  return {
    insertSpaces: !indentation.includes("\t"),
    tabSize: indentation.includes("\t") ? 1 : indentation.length,
    eol: source.includes("\r\n") ? "\r\n" : "\n",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
