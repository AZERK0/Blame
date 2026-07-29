import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";

export const immutableCacheControl = "public, max-age=31536000, immutable";
export const latestArtifactCacheControl = "public, max-age=300";
export const latestMetadataCacheControl = "public, max-age=60, must-revalidate";

export function createDownloadObjectStorage(environment = process.env) {
  const config = downloadObjectStorageConfig(environment);
  return new DownloadObjectStorage(config, createS3Client(config));
}

export function downloadObjectStorageConfig(environment = process.env) {
  const driver = optionalValue(environment, "BLAME_DOWNLOAD_STORAGE_DRIVER");
  if (driver && driver !== "s3") {
    throw new Error("BLAME_DOWNLOAD_STORAGE_DRIVER must be s3");
  }
  const config = {
    accessKeyId: requiredValue(environment, "BLAME_DOWNLOAD_S3_ACCESS_KEY_ID"),
    bucket: requiredValue(environment, "BLAME_DOWNLOAD_S3_BUCKET"),
    endpoint: requiredValue(environment, "BLAME_DOWNLOAD_S3_ENDPOINT"),
    forcePathStyle: booleanValue(
      environment.BLAME_DOWNLOAD_S3_FORCE_PATH_STYLE,
    ),
    region: requiredValue(environment, "BLAME_DOWNLOAD_S3_REGION"),
    secretAccessKey: requiredValue(
      environment,
      "BLAME_DOWNLOAD_S3_SECRET_ACCESS_KEY",
    ),
  };
  return {
    ...config,
    publicBaseUrl:
      optionalValue(environment, "BLAME_DOWNLOAD_S3_PUBLIC_BASE_URL") ??
      derivePublicBaseUrl(config),
  };
}

export class DownloadObjectStorage {
  constructor(config, client) {
    this.config = config;
    this.client = client;
  }

  async uploadVersioned(files, prefix) {
    await uploadConcurrently(files, (file) =>
      this.upload(
        file,
        objectKey(prefix, basename(file)),
        immutableCacheControl,
      ),
    );
  }

  async publishLatest(files, options = {}) {
    const metadata = files.filter(isUpdateMetadata);
    const artifacts = files.filter((file) => !isUpdateMetadata(file));
    await this.uploadLatestFiles(artifacts, latestArtifactCacheControl);
    await this.uploadLatestFiles(metadata, latestMetadataCacheControl);
    if (options.prune) await this.deleteUnexpectedLatest(files);
  }

  async upload(file, key, cacheControl) {
    const fileStat = await stat(file);
    await this.client.send(
      new PutObjectCommand({
        ACL: "public-read",
        Body: createReadStream(file),
        Bucket: this.config.bucket,
        CacheControl: cacheControl,
        ContentLength: fileStat.size,
        ContentType: contentType(file),
        Key: key,
      }),
    );
  }

  async uploadLatestFiles(files, cacheControl) {
    await uploadConcurrently(files, (file) =>
      this.upload(file, objectKey("latest", basename(file)), cacheControl),
    );
  }

  async deleteUnexpectedLatest(files) {
    const expected = new Set(
      files.map((file) => objectKey("latest", basename(file))),
    );
    const existing = await this.objectKeys("latest/");
    const stale = existing.filter((key) => !expected.has(key));
    for (const keys of batches(stale, 1000)) await this.deleteObjects(keys);
  }

  async objectKeys(prefix) {
    const keys = [];
    let continuationToken;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          ContinuationToken: continuationToken,
          Prefix: prefix,
        }),
      );
      keys.push(
        ...(response.Contents ?? []).flatMap(({ Key }) => (Key ? [Key] : [])),
      );
      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return keys;
  }

  async deleteObjects(keys) {
    if (!keys.length) return;
    const response = await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.config.bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    const failures = response.Errors ?? [];
    if (failures.length) {
      throw new Error(
        `Unable to delete S3 objects: ${JSON.stringify(failures)}`,
      );
    }
  }
}

function createS3Client(config) {
  return new S3Client({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    region: config.region,
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}

function derivePublicBaseUrl(config) {
  const endpoint = new URL(config.endpoint);
  if (config.forcePathStyle) {
    return `${endpoint.toString().replace(/\/$/, "")}/${config.bucket}`;
  }
  endpoint.hostname = `${config.bucket}.${endpoint.hostname}`;
  return endpoint.toString().replace(/\/$/, "");
}

function contentType(file) {
  const extension = extname(file).toLowerCase();
  return (
    {
      ".deb": "application/vnd.debian.binary-package",
      ".dmg": "application/x-apple-diskimage",
      ".exe": "application/vnd.microsoft.portable-executable",
      ".gz": "application/gzip",
      ".json": "application/json",
      ".rpm": "application/x-rpm",
      ".yml": "application/yaml",
      ".zip": "application/zip",
    }[extension] ?? "application/octet-stream"
  );
}

function isUpdateMetadata(file) {
  const name = basename(file);
  return name.startsWith("latest") && name.endsWith(".yml");
}

function objectKey(prefix, name) {
  return `${prefix.replace(/^\/+|\/+$/g, "")}/${name}`;
}

function requiredValue(environment, name) {
  const value = optionalValue(environment, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalValue(environment, name) {
  const value = environment[name]?.trim();
  return value || undefined;
}

function booleanValue(value) {
  return value?.trim().toLowerCase() === "true";
}

function batches(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

async function uploadConcurrently(files, upload, concurrency = 3) {
  const queue = [...files];
  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    async () => {
      while (queue.length) await upload(queue.shift());
    },
  );
  await Promise.all(workers);
}
