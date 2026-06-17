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
BLAME_RUNTIME_ROOTFS_AMD64_SHA256
BLAME_RUNTIME_ROOTFS_AMD64_URL
BLAME_RUNTIME_ROOTFS_ARM64_SHA256
BLAME_RUNTIME_ROOTFS_ARM64_URL
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

## Windows WSL Runtime Rootfs

Windows releases can use a pre-baked WSL2 rootfs so first setup skips the full runtime provisioner. Set these values in `.env.local`:

```txt
BLAME_VERSION=0.1.0
BLAME_RUNTIME_VERSION=5
BLAME_RUNTIME_UBUNTU_ROOTFS_AMD64=/path/to/ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz
BLAME_RUNTIME_UBUNTU_ROOTFS_ARM64=/path/to/ubuntu-noble-wsl-arm64-wsl.rootfs.tar.gz
```

Build and upload the runtime images:

```bash
pnpm release:windows-runtime
```

The build step must run on Windows with WSL2 available, or from WSL when Windows interop exposes `powershell.exe`, `wsl.exe`, and `wslpath`. A plain Linux host cannot build the WSL export because it cannot run `wsl.exe --import` or `wsl.exe --export`. From Linux, use `pnpm deploy:windows-runtime` only after the `.tar.gz` files already exist in `packages/desktop/dist/runtime/windows`.

The command creates `packages/desktop/dist/runtime/windows/blame-runtime-wsl-<arch>-v<BLAME_RUNTIME_VERSION>.tar.gz`, uploads it to:

```txt
/var/www/blame-downloads/latest/runtime/windows
/var/www/blame-downloads/releases/<BLAME_VERSION>/runtime/windows
```

It then writes `BLAME_RUNTIME_ROOTFS_<ARCH>_URL` and `BLAME_RUNTIME_ROOTFS_<ARCH>_SHA256` back to `.env.local`. During desktop packaging, the Windows runtime manifest is generated from those env values inside the temporary package directory. If those variables are absent, the packaged manifest keeps the Ubuntu fallback rootfs.

Use `pnpm release:windows-runtime -- --arch amd64` or `--arch arm64` to build only one architecture.

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
