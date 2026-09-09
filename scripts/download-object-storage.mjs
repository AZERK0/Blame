import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";

export const immutableCacheControl = "public, max-age=31536000, immutable";
export const latestArtifactCacheControl = "public, max-age=300";
export const latestMetadataCacheControl = "public, max-age=60, must-revalidate";
export const stagingCacheControl = "no-store";

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

  async uploadStaged(files, prefix) {
    await uploadConcurrently(files, (file) =>
      this.upload(
        file,
        objectKey(prefix, basename(file)),
        stagingCacheControl,
        false,
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

  async publishStagedLatest(prefix, options = {}) {
    const stagedFiles = await this.stagedFiles(prefix);
    if (!stagedFiles.length) {
      throw new Error(`No staged release files found under ${prefix}`);
    }
    await options.validate?.(stagedFiles.map(({ name }) => name));
    const groupedFiles = Map.groupBy(stagedFiles, ({ name }) => name);
    await this.publishStagedGroups(groupedFiles, false, options.mergeMetadata);
    await this.publishStagedGroups(groupedFiles, true, options.mergeMetadata);
    if (options.prune) {
      await this.deleteUnexpectedLatestNames([...groupedFiles.keys()]);
    }
  }

  async deletePrefix(prefix) {
    const keys = await this.objectKeys(`${normalizedPrefix(prefix)}/`);
    for (const keyBatch of batches(keys, 1000)) {
      await this.deleteObjects(keyBatch);
    }
  }

  async upload(file, key, cacheControl, publicRead = true) {
    const fileStat = await stat(file);
    const accessControl = publicRead ? { ACL: "public-read" } : {};
    await this.client.send(
      new PutObjectCommand({
        ...accessControl,
        Body: createReadStream(file),
        Bucket: this.config.bucket,
        CacheControl: cacheControl,
        ContentLength: fileStat.size,
        ContentType: contentType(file),
        Key: key,
      }),
    );
  }

  async stagedFiles(prefix) {
    const keys = await this.objectKeys(`${normalizedPrefix(prefix)}/`);
    return keys.map((key) => ({ key, name: basename(key) }));
  }

  async publishStagedGroups(groupedFiles, metadata, mergeMetadata) {
    const groups = [...groupedFiles].filter(
      ([name]) => isUpdateMetadata(name) === metadata,
    );
    const cacheControl = metadata
      ? latestMetadataCacheControl
      : latestArtifactCacheControl;
    await uploadConcurrently(groups, (group) =>
      this.publishStagedGroup(group, cacheControl, mergeMetadata),
    );
  }

  async publishStagedGroup([name, files], cacheControl, mergeMetadata) {
    if (files.length === 1) {
      await this.copyToLatest(files[0].key, name, cacheControl);
      return;
    }
    if (!isUpdateMetadata(name) || !mergeMetadata) {
      throw new Error(`Duplicate staged release file: ${name}`);
    }
    const values = await Promise.all(
      files.map(({ key }) => this.objectText(key)),
    );
    await this.uploadLatestText(
      name,
      await mergeMetadata(name, values),
      cacheControl,
    );
  }

  async copyToLatest(sourceKey, name, cacheControl) {
    await this.client.send(
      new CopyObjectCommand({
        ACL: "public-read",
        Bucket: this.config.bucket,
        CacheControl: cacheControl,
        ContentType: contentType(name),
        CopySource: copySource(this.config.bucket, sourceKey),
        Key: objectKey("latest", name),
        MetadataDirective: "REPLACE",
      }),
    );
  }

  async objectText(key) {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!response.Body) throw new Error(`Empty S3 object: ${key}`);
    return response.Body.transformToString();
  }

  async download(key, destination) {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!response.Body) throw new Error(`Empty S3 object: ${key}`);
    await pipeline(response.Body, createWriteStream(destination));
  }

  async uploadLatestText(name, value, cacheControl) {
    await this.client.send(
      new PutObjectCommand({
        ACL: "public-read",
        Body: value,
        Bucket: this.config.bucket,
        CacheControl: cacheControl,
        ContentLength: Buffer.byteLength(value),
        ContentType: contentType(name),
        Key: objectKey("latest", name),
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
    await this.deleteUnexpectedLatestKeys(expected);
  }

  async deleteUnexpectedLatestNames(names) {
    const expected = new Set(names.map((name) => objectKey("latest", name)));
    await this.deleteUnexpectedLatestKeys(expected);
  }

  async deleteUnexpectedLatestKeys(expected) {
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

function copySource(bucket, key) {
  return `${bucket}/${key}`
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function objectKey(prefix, name) {
  return `${normalizedPrefix(prefix)}/${name}`;
}

function normalizedPrefix(prefix) {
  return prefix.replace(/^\/+|\/+$/g, "");
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
