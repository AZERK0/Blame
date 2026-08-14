import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import cacache from "cacache";
import { z } from "zod";
import type { ArtifactRef, RevisionVector } from "./protocol.js";
import { artifactRefSchema } from "./schemas.js";

const maximumArtifactBytes = 50 * 1024 * 1024;
const defaultQuotaBytes = 256 * 1024 * 1024;
const encryptionVersion = 1;
const nonceBytes = 12;
const authenticationTagBytes = 16;

export type ArtifactAudience = "agent" | "reviewer" | "system";

const storedArtifactMetadataSchema = artifactRefSchema
  .extend({
    encryption: z.literal("aes-256-gcm"),
    created_at: z.string().datetime(),
    expires_at: z.string().datetime(),
    plaintext_bytes: z.number().int().nonnegative(),
    subject_revision: z
      .object({
        source_revision_id: z.string().optional(),
        environment_spec_revision_id: z.string().optional(),
        runtime_instance_id: z.string().optional(),
        index_revision_id: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

type StoredArtifactMetadata = z.infer<typeof storedArtifactMetadataSchema>;

export class ArtifactStore {
  private readonly directory: string;
  private readonly keysDirectory: string;
  private readonly quotaBytes: number;
  private keyPromise?: Promise<Buffer>;

  constructor(workspaceRoot: string, quotaBytes = defaultQuotaBytes) {
    const root = join(workspaceRoot, ".blame", "harness");
    this.directory = join(root, "artifacts");
    this.keysDirectory = join(root, "keys");
    this.quotaBytes = quotaBytes;
  }

  async put(
    content: string | Buffer,
    mediaType: string,
    schemaVersion = "1.0",
    visibility: ArtifactRef["visibility"] = "agent_redacted",
    subjectRevision?: RevisionVector,
  ): Promise<ArtifactRef> {
    const bytes = typeof content === "string" ? Buffer.from(content) : content;
    if (bytes.byteLength > maximumArtifactBytes)
      throw new Error("Artifact exceeds the 50 MiB local store limit.");
    const key = await this.key();
    const contentHash = scopedContentHash(key, bytes);
    const ref = `artifact://${contentHash}`;
    const now = new Date();
    const artifact = artifactRefSchema.parse({
      ref,
      content_hash: contentHash,
      media_type: mediaType,
      schema_version: schemaVersion,
      visibility,
    });
    const metadata = storedArtifactMetadataSchema.parse({
      ...artifact,
      encryption: "aes-256-gcm",
      created_at: now.toISOString(),
      expires_at: new Date(
        now.getTime() + retentionMilliseconds(visibility),
      ).toISOString(),
      plaintext_bytes: bytes.byteLength,
      ...(subjectRevision ? { subject_revision: subjectRevision } : {}),
    });
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const encrypted = encrypt(bytes, key, ref);
    await cacache.put(this.directory, ref, encrypted, {
      algorithms: ["sha256"],
      metadata,
      size: encrypted.byteLength,
    });
    const stored = await cacache.get.info(this.directory, ref, {
      memoize: false,
    });
    if (stored?.path) await chmod(stored.path, 0o600);
    await this.gc();
    return artifact;
  }

  async get(
    ref: string,
    options: { audience?: ArtifactAudience } = {},
  ): Promise<Buffer> {
    const metadata = await this.metadata(ref, options);
    const stored = await cacache.get(this.directory, ref, { memoize: false });
    const key = await this.key();
    const bytes = decrypt(stored.data, key, ref);
    if (
      bytes.byteLength !== metadata.plaintext_bytes ||
      scopedContentHash(key, bytes) !== metadata.content_hash
    )
      throw new Error("Artifact integrity verification failed.");
    return bytes;
  }

  async metadata(
    ref: string,
    options: { audience?: ArtifactAudience } = {},
  ): Promise<StoredArtifactMetadata> {
    assertArtifactRef(ref);
    const stored = await cacache.get.info(this.directory, ref, {
      memoize: false,
    });
    if (!stored) throw new Error("Artifact was not found or has expired.");
    const metadata = storedArtifactMetadataSchema.parse(stored.metadata);
    if (metadata.ref !== ref || metadata.content_hash !== ref.slice(11))
      throw new Error("Artifact metadata integrity verification failed.");
    assertAudience(metadata.visibility, options.audience ?? "system");
    if (Date.parse(metadata.expires_at) <= Date.now()) {
      await cacache.rm.entry(this.directory, ref);
      throw new Error("Artifact was not found or has expired.");
    }
    return metadata;
  }

  async gc(now = Date.now()) {
    const entries = Object.values(
      (await cacache.ls(this.directory).catch(() => ({}))) as Record<
        string,
        { key: string; size?: number; time?: number; metadata?: unknown }
      >,
    );
    const retained: Array<{ key: string; size: number; created: number }> = [];
    for (const entry of entries) {
      const parsed = storedArtifactMetadataSchema.safeParse(entry.metadata);
      if (!parsed.success || Date.parse(parsed.data.expires_at) <= now) {
        await cacache.rm
          .entry(this.directory, entry.key)
          .catch(() => undefined);
        continue;
      }
      retained.push({
        key: entry.key,
        size: entry.size ?? 0,
        created: Date.parse(parsed.data.created_at) || entry.time || 0,
      });
    }
    let total = retained.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of retained.sort(
      (left, right) => left.created - right.created,
    )) {
      if (total <= this.quotaBytes) break;
      await cacache.rm.entry(this.directory, entry.key).catch(() => undefined);
      total -= entry.size;
    }
    return { entries: retained.length, retained_bytes: Math.max(0, total) };
  }

  verify() {
    return cacache.verify(this.directory);
  }

  private key() {
    this.keyPromise ??= this.loadOrCreateKey();
    return this.keyPromise;
  }

  private async loadOrCreateKey() {
    const path = join(this.keysDirectory, "artifacts-v1.key");
    await mkdir(this.keysDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.keysDirectory, 0o700);
    try {
      const current = await readFile(path);
      if (current.byteLength !== 32)
        throw new Error("Artifact encryption key is invalid.");
      return current;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    const created = randomBytes(32);
    try {
      await writeFile(path, created, { flag: "wx", mode: 0o600 });
      return created;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const concurrent = await readFile(path);
      if (concurrent.byteLength !== 32)
        throw new Error("Artifact encryption key is invalid.");
      return concurrent;
    }
  }
}

function scopedContentHash(key: Buffer, bytes: Buffer) {
  return createHmac("sha256", key)
    .update("blame-artifact-ref-v1\0")
    .update(bytes)
    .digest("hex");
}

function encrypt(bytes: Buffer, key: Buffer, ref: string) {
  const nonce = randomBytes(nonceBytes);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(ref));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([
    Buffer.from([encryptionVersion]),
    nonce,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}

function decrypt(payload: Buffer, key: Buffer, ref: string) {
  if (
    payload.byteLength < 1 + nonceBytes + authenticationTagBytes ||
    payload[0] !== encryptionVersion
  )
    throw new Error("Artifact encryption envelope is invalid.");
  const nonce = payload.subarray(1, 1 + nonceBytes);
  const tag = payload.subarray(
    1 + nonceBytes,
    1 + nonceBytes + authenticationTagBytes,
  );
  const ciphertext = payload.subarray(1 + nonceBytes + authenticationTagBytes);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(Buffer.from(ref));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function assertArtifactRef(ref: string) {
  const hash = ref.startsWith("artifact://") ? ref.slice(11) : "";
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid artifact ref.");
}

function assertAudience(
  visibility: ArtifactRef["visibility"],
  audience: ArtifactAudience,
) {
  const allowed =
    audience === "system" ||
    (audience === "reviewer" && visibility !== "sealed_raw") ||
    (audience === "agent" && visibility === "agent_redacted");
  if (!allowed)
    throw new Error(
      "Artifact access policy denies this visibility for the caller.",
    );
}

function retentionMilliseconds(visibility: ArtifactRef["visibility"]) {
  const days = visibility === "sealed_raw" ? 7 : 30;
  return days * 24 * 60 * 60 * 1_000;
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
