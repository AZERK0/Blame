# Production download storage

Use the public-object `blame-prod-downloads-gra` bucket in Gravelines. Keep it separate from private attachments and backups because desktop installers and runtime images are intentionally public and have independent retention rules.

Configure release publishers with:

```txt
BLAME_DOWNLOAD_STORAGE_DRIVER=s3
BLAME_DOWNLOAD_S3_ENDPOINT=https://s3.gra.io.cloud.ovh.net
BLAME_DOWNLOAD_S3_REGION=gra
BLAME_DOWNLOAD_S3_BUCKET=blame-prod-downloads-gra
BLAME_DOWNLOAD_S3_ACCESS_KEY_ID=
BLAME_DOWNLOAD_S3_SECRET_ACCESS_KEY=
BLAME_DOWNLOAD_S3_FORCE_PATH_STYLE=false
BLAME_DOWNLOAD_S3_PUBLIC_BASE_URL=https://blame-prod-downloads-gra.s3.gra.io.cloud.ovh.net
```

The credentials require bucket listing plus object read, write, ACL, and delete permissions only inside this bucket. Each published object receives the `public-read` ACL. Bucket listing can remain private.

Create the bucket:

```sh
aws --endpoint-url "$BLAME_DOWNLOAD_S3_ENDPOINT" s3api create-bucket \
  --bucket "$BLAME_DOWNLOAD_S3_BUCKET" \
  --region "$BLAME_DOWNLOAD_S3_REGION" \
  --acl private \
  --create-bucket-configuration "LocationConstraint=$BLAME_DOWNLOAD_S3_REGION"
```

Runtime images use immutable one-year browser caching. Desktop installers only exist below `latest/`, use short caching, and update metadata is published after its referenced artifacts.

The `download.blame.so` Dokploy application contains no release volume. It redirects every request to:

```txt
https://blame-prod-downloads-gra.s3.gra.io.cloud.ovh.net
```

Verify both the redirect and anonymous object access after each infrastructure change:

```sh
curl -fsSI https://download.blame.so/latest/latest.yml
curl -fsSI https://blame-prod-downloads-gra.s3.gra.io.cloud.ovh.net/latest/latest.yml
```

Do not apply the private attachment bucket rules to this bucket. In particular, public downloads must not use expiring signed URLs. Keep every runtime version referenced by a supported desktop release.
