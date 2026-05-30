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
```

A typical Dokploy or static server path can look like this:

```txt
/var/www/blame-downloads
  latest
  releases
```

Use `BLAME_DOWNLOAD_BASE_URL` for the public URL serving the `latest` folder, for example `https://download.example.com/latest`.

The repository includes a Dokploy-ready compose file at `deploy/downloads/docker-compose.yml`. It serves `/var/www/blame-downloads` by default. Override the host path with `BLAME_DOWNLOADS_PATH` if needed.
