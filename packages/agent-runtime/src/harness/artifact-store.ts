import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import cacache from "cacache";
import type { ArtifactRef } from "./protocol.js";
import { sha256 } from "./protocol.js";
import { artifactRefSchema } from "./schemas.js";

const maximumArtifactBytes = 50 * 1024 * 1024;

export class ArtifactStore {
  private readonly directory: string;

  constructor(workspaceRoot: string) {
    this.directory = join(workspaceRoot, ".blame", "harness", "artifacts");
  }

  async put(
    content: string | Buffer,
    mediaType: string,
    schemaVersion = "1.0",
    visibility: ArtifactRef["visibility"] = "agent_redacted",
  ): Promise<ArtifactRef> {
    const bytes = typeof content === "string" ? Buffer.from(content) : content;
    if (bytes.byteLength > maximumArtifactBytes)
      throw new Error("Artifact exceeds the 50 MiB local store limit.");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const contentHash = sha256(bytes);
    const artifact = artifactRefSchema.parse({
      ref: `artifact://${contentHash}`,
      content_hash: contentHash,
      media_type: mediaType,
      schema_version: schemaVersion,
      visibility,
    });
    await cacache.put(this.directory, artifact.ref, bytes, {
      algorithms: ["sha256"],
      metadata: artifact,
      size: bytes.byteLength,
    });
    const stored = await cacache.get.info(this.directory, artifact.ref, {
      memoize: false,
    });
    if (stored?.path) await chmod(stored.path, 0o600);
    return artifact;
  }

  async get(ref: string) {
    const hash = ref.startsWith("artifact://") ? ref.slice(11) : "";
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid artifact ref.");
    const stored = await cacache.get(this.directory, ref, { memoize: false });
    const metadata = artifactRefSchema.parse(stored.metadata);
    if (
      metadata.ref !== ref ||
      metadata.content_hash !== hash ||
      sha256(stored.data) !== hash
    )
      throw new Error("Artifact integrity verification failed.");
    return stored.data;
  }

  verify() {
    return cacache.verify(this.directory);
  }
}
