import { createHash } from "node:crypto";
import type { ContentBlock, Message } from "@cline/sdk";

export const maximumImageEncodedBytes = 5 * 1024 * 1024;
const maximumImageContextBytes = 8 * 1024 * 1024;

type NativeImage = { type: "image"; mediaType: string; data: string };
type ImageText = { type: "text"; text: string };
type ImageGroup = { first: number; last: number; bytes: number; key: string };
type ImageReplacement = NativeImage | ImageText;

export function projectImageContext(messages: Message[]): Message[] {
  const images: NativeImage[] = [];
  for (const message of messages) collectMessageImages(message, images);
  if (!images.length) return messages;
  const groups = imageGroups(images);
  const selected = selectImages(groups);
  let index = 0;
  return messages.map((message) => mapMessageImages(message, (image) => {
    const group = groups[index++]!;
    if (!selected.has(group.key)) return omittedImage(group.bytes);
    return group.first === index - 1 ? image : duplicateImage();
  }));
}

function collectMessageImages(message: Message, images: NativeImage[]) {
  if (!Array.isArray(message.content)) return;
  for (const block of message.content) {
    if (nativeImage(block)) images.push(block);
    else if (block.type === "tool_result") collectImages(block.content, images);
  }
}

function collectImages(value: unknown, images: NativeImage[]) {
  if (nativeImage(value)) images.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectImages(item, images));
  else if (value && typeof value === "object")
    Object.values(value).forEach((item) => collectImages(item, images));
}

function nativeImage(value: unknown): value is NativeImage {
  if (!value || typeof value !== "object") return false;
  const image = value as Record<string, unknown>;
  return image.type === "image" && typeof image.mediaType === "string" && typeof image.data === "string";
}

function imageGroups(images: NativeImage[]) {
  const unique = new Map<string, ImageGroup>();
  return images.map((image, index) => {
    const key = createHash("sha256").update(image.mediaType).update("\0").update(image.data).digest("hex");
    const group = unique.get(key) ?? { first: index, last: index, bytes: image.data.length, key };
    group.last = index;
    unique.set(key, group);
    return group;
  });
}

function selectImages(groups: ImageGroup[]) {
  const latest = [...new Set(groups)].sort((left, right) => right.last - left.last);
  const selected = new Set<string>();
  let bytes = 0;
  for (const group of latest) {
    if (group.bytes > maximumImageEncodedBytes || bytes + group.bytes > maximumImageContextBytes) continue;
    selected.add(group.key);
    bytes += group.bytes;
  }
  return selected;
}

function mapMessageImages(message: Message, replace: (image: NativeImage) => ImageReplacement): Message {
  if (!Array.isArray(message.content)) return message;
  const content = message.content.map((block: ContentBlock): ContentBlock => {
    if (nativeImage(block)) return replace(block);
    if (block.type !== "tool_result") return block;
    return { ...block, content: mapOutputImages(block.content, replace) };
  });
  return { ...message, content };
}

function mapOutputImages<T>(value: T, replace: (image: NativeImage) => ImageReplacement): T {
  if (nativeImage(value)) return replace(value) as T;
  if (Array.isArray(value)) return value.map((item) => mapOutputImages(item, replace)) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapOutputImages(item, replace)])) as T;
}

function duplicateImage(): ImageText {
  return { type: "text", text: "Duplicate image data; see the earlier result." };
}

function omittedImage(bytes: number): ImageText {
  return { type: "text", text: bytes > maximumImageEncodedBytes
    ? "Image exceeds the provider image limit. Resize or crop it before reading again."
    : "Image omitted to make room for recent images. View it again if needed." };
}
