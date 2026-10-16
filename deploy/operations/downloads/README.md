# Production downloads

Desktop installers and runtime images are published as [GitHub Releases](https://github.com/AZERK0/Blame/releases) (see [RELEASING.md](../../../RELEASING.md)). The `download.blame.so` Dokploy application runs the redirector in [`deploy/downloads`](../../downloads). It stores no files and has no volume.

| Request                                  | Redirect                                                   |
| ---------------------------------------- | ---------------------------------------------------------- |
| `/`, `/latest`                           | `BLAME_DOWNLOAD_LANDING_URL` (`https://blame.so/download`) |
| `/latest/<file>`                         | `BLAME_RELEASES_URL/latest/download/<file>`                |
| `/runtime/v1/` … `/runtime/v9/`          | `BLAME_LEGACY_DOWNLOAD_BASE_URL` followed by the same path |
| `/runtime/v<N>/[windows/\|macos/]<file>` | `BLAME_RELEASES_URL/download/runtime-v<N>/<file>`          |

Configure the application with:

```txt
BLAME_RELEASES_URL=https://github.com/AZERK0/Blame/releases
BLAME_LEGACY_DOWNLOAD_BASE_URL=https://blame-prod-downloads-gra.s3.gra.io.cloud.ovh.net
BLAME_DOWNLOAD_LANDING_URL=https://blame.so/download
```

Verify the redirects after each infrastructure change:

```sh
curl -fsSIL https://download.blame.so/latest/latest.yml
curl -fsSIL https://download.blame.so/runtime/v9/manifest.json
```

## Legacy bucket

Runtimes v1 to v9 were published to the public-object `blame-prod-downloads-gra` OVH bucket before releases moved to GitHub. Nothing writes to it anymore. Keep it read-only while a supported desktop version still references one of those runtimes. The `latest/` prefix in it is no longer served.
