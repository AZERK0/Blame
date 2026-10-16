# Releasing

Everything is built on GitHub-hosted runners and published as a GitHub Release. A release starts when you push a tag.

| Workflow                                                 | Trigger                         | Result                                                                   |
| -------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| [CI](.github/workflows/ci.yml)                           | Pull requests, pushes to `main` | Line budgets, typecheck, and tests                                       |
| [Release desktop](.github/workflows/release-desktop.yml) | Tag `v<semver>`                 | **Draft** release with the installers, update metadata, and `SHA256SUMS` |
| [Release runtime](.github/workflows/release-runtime.yml) | Tag `runtime-v<version>`        | Published release with the four runtime images and their `manifest.json` |

Users never download from GitHub URLs directly. [`download.blame.so`](deploy/downloads) is a stable redirector, so you can change the hosting later without breaking installed apps:

| Public URL                                         | Redirects to                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| `download.blame.so/latest/<file>`                  | The latest published desktop release, `releases/latest/download/<file>` |
| `download.blame.so/runtime/v<N>/[platform/]<file>` | Release `runtime-v<N>`, `releases/download/runtime-v<N>/<file>`         |
| `download.blame.so/runtime/v1` … `v9`              | The legacy object storage bucket (published before GitHub Releases)     |

## Desktop app

1. Check that CI is green on `main`.
2. Tag and push:

   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```

3. The workflow checks that the runtime referenced by `packages/desktop/resources/runtime/*/manifest.json` is published, builds macOS (x64 and arm64, signed and notarized), Windows, and Linux, and then creates a draft release.
4. **Pre-production test.** Only maintainers can see a draft. Download the installers from the draft on the [releases page](https://github.com/AZERK0/Blame/releases) and test them.
5. Edit the generated notes and click **Publish release**. From then on, `download.blame.so/latest`, the download page, and the in-app updater serve this version.

A tag with a suffix such as `v1.2.0-beta.1` creates a prerelease. GitHub never treats a prerelease as the latest release, so it never reaches users through the updater or the download page.

If a job fails, use **Re-run failed jobs** on the workflow run. To abandon a release, delete the draft and the tag (`git push origin :v1.2.0`).

## Desktop runtime

The Windows (WSL rootfs) and macOS (Lima image) runtimes are versioned separately from the app. Release a new one whenever the runtime images change.

1. Bump `runtimeVersion` in `packages/desktop/resources/runtime/windows/manifest.json` and `packages/desktop/resources/runtime/macos/manifest.json`, then merge.
2. Tag and push. The tag must match the manifests:

   ```bash
   git tag runtime-v10
   git push origin runtime-v10
   ```

3. Wait for the release to be published (about 1h30). The workflow publishes it right away without making it the latest release, because desktop builds need to download it.
4. Release the desktop app as usual.

Never delete a runtime release that a published desktop version still references.

## Local builds

Use local builds to try a change before you tag it. They never publish anything.

```bash
pnpm build:desktop                         # installers for this machine, in packages/desktop/dist
pnpm build:desktop --mac --x64 --arm64     # both macOS architectures
pnpm build:runtime                         # runtime images for this machine, in packages/desktop/dist/runtime
```

Local desktop builds use the same update feed and published runtime as production builds. To sign macOS builds locally, put the signing variables listed below in the ignored root `.env.local`. [packages/desktop/README.md](packages/desktop/README.md) lists the runtime build prerequisites.

## Repository configuration

Secrets used for macOS signing and notarization:

```txt
APPLE_API_ISSUER
APPLE_API_KEY_ID
APPLE_API_KEY_P8_B64
MAC_CSC_KEY_PASSWORD
MAC_CSC_LINK
```

Optional variables: `BLAME_HOMEPAGE`, `BLAME_MAINTAINER_EMAIL`, `BLAME_MAINTAINER_NAME`.

## Sandbox runner image

The cloud preview sandbox runner image is still published manually with `pnpm release:sandbox-runner`. It is a container image, not a GitHub Release.
