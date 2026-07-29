# Blame Desktop

Electron shell for the Blame app and Cline SDK runtime IPC.

## Packaging

Build the desktop app before packaging installers:

```bash
pnpm --filter @blame/desktop build
```

Create installers for the current platform:

```bash
pnpm --filter @blame/desktop package
```

Platform-specific commands:

```bash
pnpm --filter @blame/desktop package:mac
pnpm --filter @blame/desktop package:win
pnpm --filter @blame/desktop package:linux
```

The installers are written to `packages/desktop/dist`.

## Release Hosting

The desktop release workflow builds macOS, Windows, and Linux installers, then uploads them directly to OVH Object Storage through its S3-compatible API. The VPS never stores release files.

Required GitHub secrets:

```txt
BLAME_DOWNLOAD_BASE_URL
BLAME_DOWNLOAD_S3_ACCESS_KEY_ID
BLAME_DOWNLOAD_S3_SECRET_ACCESS_KEY
```

Required GitHub variables:

```txt
BLAME_DOWNLOAD_S3_BUCKET
BLAME_DOWNLOAD_S3_ENDPOINT
BLAME_DOWNLOAD_S3_FORCE_PATH_STYLE
BLAME_DOWNLOAD_S3_REGION
```

Optional GitHub variables:

```txt
BLAME_HOMEPAGE
BLAME_MAINTAINER_EMAIL
BLAME_MAINTAINER_NAME
BLAME_RUNTIME_VERSION
```

The production bucket uses this object layout:

```txt
latest/
runtime/v<BLAME_RUNTIME_VERSION>/
```

Desktop releases only keep the current installers under `latest/`. Artifacts are uploaded first, update metadata is uploaded last, and stale objects are removed only after the new metadata is available. Runtime images remain versioned and immutable because installed desktop versions may need to download their matching runtime again.

Keep `BLAME_DOWNLOAD_BASE_URL=https://download.blame.so/latest`. The Dokploy-ready image in `deploy/downloads` only redirects requests to the public S3 object URL and has no volume mount. Configure it with:

```txt
BLAME_DOWNLOAD_REDIRECT_BASE_URL=https://blame-prod-downloads-gra.s3.gra.io.cloud.ovh.net
```

See `deploy/operations/downloads/README.md` for bucket creation, migration, and verification.

## Prebuilt Desktop Runtimes

Windows and macOS installers use versioned runtime images so first setup only imports an image instead of installing Node, the Cline SDK, containerd, BuildKit, and nerdctl.

The base images keep Cline's cloud providers, including OpenAI Codex OAuth and the Anthropic API. They exclude the native Codex and Claude CLI payloads because those binaries are only required by the dedicated local CLI providers. Enabling either local CLI provider later must include its authentication and executable-path setup.

On Arch Linux, start Docker and install `qemu-img` plus `qemu-system-x86_64`. Then set `BLAME_RUNTIME_VERSION` in `.env.local` and build both runtimes for the host architecture:

```bash
pnpm build:runtime
```

The platform-specific commands are useful while iterating:

```bash
pnpm build:runtime:windows
pnpm build:runtime:macos
```

The Windows command builds a WSL-compatible rootfs with Docker and does not require Windows, WSL, or PowerShell. The macOS command builds a Lima qcow2 image inside a temporary QEMU VM. Lima and every downloaded base image are pinned and checksum-verified.

The macOS builder also reboots the finished image and checks the runtime. Run `pnpm verify:runtime:macos` to repeat only that verification without rebuilding it.

Artifacts are written below `packages/desktop/dist/runtime/windows` and `packages/desktop/dist/runtime/macos`. Add `-- --arch amd64`, `-- --arch arm64`, `-- --arch x86_64`, or `-- --arch aarch64` to a platform command. `pnpm build:runtime:all` builds all four artifacts; foreign architectures require Docker binfmt and the matching QEMU system emulator and firmware.

Once all four artifacts exist, publish them and their immutable manifest with:

```bash
pnpm deploy:runtime
```

`pnpm release:runtime` combines the all-architecture build and deployment. Files are published under `runtime/v<BLAME_RUNTIME_VERSION>`, and desktop release packaging refuses an unverified or missing target runtime. The manual `Runtime release` GitHub Actions workflow is the native x86-64/ARM64 fallback when local cross-emulation is not available.
