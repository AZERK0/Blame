import type { AgentToolContext, ImageContent } from "@cline/sdk";
import { basename, dirname, extname, isAbsolute } from "node:path";
import { maximumImageEncodedBytes } from "../image-context.js";
import type { LightToolResult } from "./light-contracts.js";
import { WorkspaceFiles } from "./workspace-files.js";

const imageTypes = new Map([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".gif", "image/gif"], [".webp", "image/webp"],
]);
const maximumImageBytes = Math.floor(maximumImageEncodedBytes * 3 / 4);
type ImageReadData = { path: string; view: "image"; bytes: number };

export async function readWorkspaceImage(
  files: WorkspaceFiles, path: string, context: Partial<AgentToolContext>,
): Promise<LightToolResult<ImageReadData> | undefined> {
  const mediaType = imageTypes.get(extname(path).toLowerCase());
  if (!mediaType) return undefined;
  if (context.metadata?.modelSupportsImages !== true)
    return { status: "blocked", category: "input", message: "The current model does not support image input." };
  if (await files.fileSize(path) > maximumImageBytes)
    return { status: "blocked", category: "input", message: "Image exceeds the 5 MiB encoded image limit. Resize or crop it with a project tool before reading." };
  context.signal?.throwIfAborted();
  const { content } = await files.read(path);
  context.signal?.throwIfAborted();
  if (content.length > maximumImageBytes || !matchesImageSignature(content, mediaType))
    return { status: "blocked", category: "input", message: "Image bytes do not match the supported format or size." };
  const image: ImageContent = { type: "image", mediaType, data: content.toString("base64") };
  return { status: "ok", data: { path, view: "image", bytes: content.length }, content: [image] };
}

function matchesImageSignature(content: Buffer, mediaType: string) {
  if (mediaType === "image/png") return content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mediaType === "image/jpeg") return content.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (mediaType === "image/gif") return ["GIF87a", "GIF89a"].includes(content.toString("ascii", 0, 6));
  return content.toString("ascii", 0, 4) === "RIFF" && content.toString("ascii", 8, 12) === "WEBP";
}

export async function readIsolatedEnvironmentImage(
  files: WorkspaceFiles, path: string, context: Partial<AgentToolContext>, isolated?: boolean,
): Promise<LightToolResult<ImageReadData> | undefined> {
  if (!isolated || !isAbsolute(path) || !outsideWorkspace(files, path)) return undefined;
  const external = new WorkspaceFiles(dirname(path));
  const result = await readWorkspaceImage(external, basename(path), context);
  if (result?.status !== "ok") return result;
  return { ...result, data: { ...result.data, path } };
}

function outsideWorkspace(files: WorkspaceFiles, path: string) {
  try { files.normalizePath(path); return false; }
  catch { return true; }
}
