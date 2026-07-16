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

The desktop release workflow builds macOS, Windows, and Linux installers, then uploads them to a VPS over SSH when deployment is enabled.

Required GitHub secrets:

```txt
BLAME_DOWNLOAD_HOST
BLAME_DOWNLOAD_USER
BLAME_DOWNLOAD_SSH_KEY
BLAME_DOWNLOAD_PATH
BLAME_DOWNLOAD_BASE_URL
```

Optional GitHub secret:

```txt
BLAME_DOWNLOAD_SSH_PORT
```

Optional GitHub variables:

```txt
BLAME_HOMEPAGE
BLAME_MAINTAINER_EMAIL
BLAME_MAINTAINER_NAME
BLAME_RUNTIME_VERSION
```

A typical Dokploy or static server path can look like this:

```txt
/var/www/blame-downloads
  latest
  releases
```

Use `BLAME_DOWNLOAD_BASE_URL` for the public URL serving the `latest` folder, for example `https://download.example.com/latest`.

The repository includes a Dokploy-ready Dockerfile at `deploy/downloads/Dockerfile`. Use `deploy/downloads` as the Docker context path. Mount `/var/www/blame-downloads` to `/usr/share/nginx/html` in Dokploy so uploaded release files are served by the container.

If you prefer Docker Compose, `deploy/downloads/docker-compose.yml` uses the same image and serves `/var/www/blame-downloads` by default. Override the host path with `BLAME_DOWNLOADS_PATH` if needed.

## Prebuilt Desktop Runtimes

Windows and macOS installers use versioned runtime images so first setup only imports an image instead of installing Node, the Cline SDK, containerd, BuildKit, and nerdctl.

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

## VPS Linux Builds

GitHub Actions can stay as the full cross-platform release backup. For Linux-only builds directly on the VPS, create a second Dokploy app with:

```txt
Build Type: Dockerfile
Docker File: deploy/desktop-builder/Dockerfile
Docker Context Path: /
```

Add this bind mount to the builder app:

```txt
Host Path: /var/www/blame-downloads
Mount Path: /downloads
```

Set these build arguments in Dokploy:

```txt
BLAME_DOWNLOAD_BASE_URL=https://download.example.com/latest
BLAME_VERSION=0.1.0
```

Optional build arguments:

```txt
BLAME_HOMEPAGE=https://blame.dev
BLAME_LINUX_TARGETS=AppImage
BLAME_MAINTAINER_EMAIL=hello@blame.dev
BLAME_MAINTAINER_NAME=Blame
```

When you click rebuild or deploy in Dokploy, Docker builds the Linux installers, then the container copies them to:

```txt
/var/www/blame-downloads/latest
/var/www/blame-downloads/releases/<BLAME_VERSION>
```

This VPS builder produces Linux artifacts only. Keep GitHub Actions for macOS and Windows releases.

Use `BLAME_LINUX_TARGETS="AppImage deb rpm"` if you want all Linux package formats from the VPS builder. The default is only `AppImage` because it is much faster on small VPS instances.
