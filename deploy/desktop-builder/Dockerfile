FROM node:22-bookworm AS build

WORKDIR /app

ARG BLAME_DOWNLOAD_BASE_URL
ARG BLAME_HOMEPAGE=https://blame.dev
ARG BLAME_MAINTAINER_EMAIL=hello@blame.dev
ARG BLAME_MAINTAINER_NAME=Blame
ARG BLAME_VERSION=0.0.0
ARG BLAME_LINUX_TARGETS=AppImage

ENV BLAME_DOWNLOAD_BASE_URL=${BLAME_DOWNLOAD_BASE_URL}
ENV BLAME_HOMEPAGE=${BLAME_HOMEPAGE}
ENV BLAME_MAINTAINER_EMAIL=${BLAME_MAINTAINER_EMAIL}
ENV BLAME_MAINTAINER_NAME=${BLAME_MAINTAINER_NAME}
ENV BLAME_VERSION=${BLAME_VERSION}
ENV BLAME_LINUX_TARGETS=${BLAME_LINUX_TARGETS}
ENV CI=true
ENV CSC_IDENTITY_AUTO_DISCOVERY=false
ENV PATH=/pnpm:$PATH
ENV PNPM_HOME=/pnpm

RUN corepack enable
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates fakeroot rpm xz-utils && rm -rf /var/lib/apt/lists/*

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @blame/desktop build
RUN pnpm --filter @blame/desktop package -- --linux $BLAME_LINUX_TARGETS --x64 --publish never
RUN mkdir -p /release-files && find packages/desktop/dist -maxdepth 1 -type f \( -name "*.AppImage" -o -name "*.blockmap" -o -name "*.deb" -o -name "*.rpm" -o -name "*-linux.yml" \) -exec cp {} /release-files/ \;

FROM nginx:1.27-alpine

ARG BLAME_VERSION=local

ENV BLAME_RELEASE_ROOT=/downloads
ENV BLAME_VERSION=${BLAME_VERSION}

COPY --from=build /release-files /release-files
COPY deploy/desktop-builder/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh && mkdir -p /downloads/latest /downloads/releases

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
