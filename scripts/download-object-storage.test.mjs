import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DownloadObjectStorage,
  downloadObjectStorageConfig,
  immutableCacheControl,
  latestArtifactCacheControl,
  latestMetadataCacheControl,
} from "./download-object-storage.mjs";

const config = {
  accessKeyId: "access",
  bucket: "downloads",
  endpoint: "https://s3.gra.io.cloud.ovh.net",
  forcePathStyle: false,
  publicBaseUrl: "https://downloads.s3.gra.io.cloud.ovh.net",
  region: "gra",
  secretAccessKey: "secret",
};

test("derives the public virtual-hosted S3 URL", () => {
  const resolved = downloadObjectStorageConfig({
    BLAME_DOWNLOAD_S3_ACCESS_KEY_ID: "access",
    BLAME_DOWNLOAD_S3_BUCKET: "downloads",
    BLAME_DOWNLOAD_S3_ENDPOINT: "https://s3.gra.io.cloud.ovh.net",
    BLAME_DOWNLOAD_S3_FORCE_PATH_STYLE: "false",
    BLAME_DOWNLOAD_S3_REGION: "gra",
    BLAME_DOWNLOAD_S3_SECRET_ACCESS_KEY: "secret",
  });

  assert.equal(
    resolved.publicBaseUrl,
    "https://downloads.s3.gra.io.cloud.ovh.net",
  );
});

test("uploads versioned artifacts as immutable public objects", async () => {
  await withReleaseFiles(async ({ artifact }) => {
    const client = new RecordingS3Client();
    const storage = new DownloadObjectStorage(config, client);

    await storage.uploadVersioned([artifact], "releases/1.2.3");

    const command = client.commands[0];
    assert.ok(command instanceof PutObjectCommand);
    assert.equal(command.input.ACL, "public-read");
    assert.equal(command.input.CacheControl, immutableCacheControl);
    assert.equal(command.input.ContentLength, 8);
    assert.equal(command.input.Key, "releases/1.2.3/blame.exe");
  });
});

test("publishes latest metadata last and removes stale objects", async () => {
  await withReleaseFiles(async ({ artifact, metadata }) => {
    const client = new RecordingS3Client(["latest/obsolete.exe"]);
    const storage = new DownloadObjectStorage(config, client);

    await storage.publishLatest([metadata, artifact], { prune: true });

    const artifactUpload = client.commands[0];
    const metadataUpload = client.commands[1];
    assert.ok(artifactUpload instanceof PutObjectCommand);
    assert.ok(metadataUpload instanceof PutObjectCommand);
    assert.equal(artifactUpload.input.CacheControl, latestArtifactCacheControl);
    assert.equal(metadataUpload.input.CacheControl, latestMetadataCacheControl);
    assert.ok(client.commands[2] instanceof ListObjectsV2Command);
    assert.ok(client.commands[3] instanceof DeleteObjectsCommand);
  });
});

test("does not prune latest objects for a partial platform release", async () => {
  await withReleaseFiles(async ({ artifact, metadata }) => {
    const client = new RecordingS3Client(["latest/other-platform.dmg"]);
    const storage = new DownloadObjectStorage(config, client);

    await storage.publishLatest([metadata, artifact]);

    assert.equal(
      client.commands.some(
        (command) =>
          command instanceof ListObjectsV2Command ||
          command instanceof DeleteObjectsCommand,
      ),
      false,
    );
  });
});

class RecordingS3Client {
  constructor(existingKeys = []) {
    this.commands = [];
    this.existingKeys = existingKeys;
  }

  async send(command) {
    this.commands.push(command);
    if (command instanceof ListObjectsV2Command) {
      return {
        Contents: this.existingKeys.map((Key) => ({ Key })),
        IsTruncated: false,
      };
    }
    return {};
  }
}

async function withReleaseFiles(run) {
  const directory = await mkdtemp(join(tmpdir(), "blame-download-storage-"));
  const artifact = join(directory, "blame.exe");
  const metadata = join(directory, "latest.yml");
  try {
    await writeFile(artifact, "artifact");
    await writeFile(metadata, "metadata");
    await run({ artifact, metadata });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
