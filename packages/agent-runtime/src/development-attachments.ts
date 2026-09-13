import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LightWorkspaceExecutor } from "./harness/light-executor.js";

export type DevelopmentAttachmentStorage = {
  executor: LightWorkspaceExecutor;
  workspaceRoot: string;
};

export async function writeDevelopmentAttachment(
  name: string,
  content: Buffer,
  directory: string,
  storage?: DevelopmentAttachmentStorage,
) {
  if (storage) {
    const result = await storage.executor({
      tool: "store_attachment",
      workspaceRoot: storage.workspaceRoot,
      input: { name, contentBase64: content.toString("base64") },
    });
    const data =
      result.status === "ok"
        ? (result.data as { path?: unknown } | undefined)
        : undefined;
    if (typeof data?.path !== "string" || !data.path)
      throw new Error(`Unable to store attachment ${name} in the workspace`);
    return data.path;
  }
  await mkdir(directory, { recursive: true });
  const filename = name.replace(/[^a-zA-Z0-9._-]/g, "_") || "attachment";
  const path = join(directory, `${randomUUID()}-${filename}`);
  await writeFile(path, content);
  return path;
}

export async function storeWorkspaceAttachment(
  workspaceRoot: string,
  input: unknown,
) {
  const attachment = input as {
    name?: unknown;
    contentBase64?: unknown;
  } | null;
  if (
    typeof attachment?.name !== "string" ||
    typeof attachment.contentBase64 !== "string"
  )
    throw new Error("Invalid workspace attachment");
  return writeDevelopmentAttachment(
    attachment.name,
    Buffer.from(attachment.contentBase64, "base64"),
    join(workspaceRoot, ".blame", "attachments", randomUUID()),
  );
}
