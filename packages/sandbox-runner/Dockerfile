FROM docker/buildx-bin:master@sha256:31c73b175b33853bc9b131f295d8a20dea9ba487d9f5e703483c24a7b1a1615a AS buildx

FROM amazonlinux:2023.12.20260710.0@sha256:2d3d063f7fc9fed492a1a7286a88f9852e9b391aa7a6fe91dedbb8381e0bb5b0

ARG NODE_VERSION=24.18.1
ARG NODE_SHA256=d6c664df3f3f61458e8c277585571328522d705166723a7c7823a9253a4d15a0
ARG NPM_VERSION=12.0.2
ARG NPM_SHA512=b885e890b9418fa1693544d05f53e64f9a73ec194837d4258b15fecdd692347b1dd2a517b1b0cbaf9d31cd8e92c3b70956bd2ecc72833a57b4b3098f5bfa7943
ARG DOCKER_VERSION=29.7.1
ARG DOCKER_SHA256=0fcea2a8b4d1b54ccc9010e3451b78504a369d414f37eb3bb79300e1b5c22ce6
ARG COMPOSE_VERSION=5.3.1
ARG COMPOSE_SHA256=f9ebc6ebdb19d769b793c245a736caaeb198c62587f13b25c660c13b4987f959
ARG BLAME_RUNNER_VERSION=0.2.15
ARG BLAME_RUNNER_IMAGE_DIGEST=sha256:development

RUN dnf upgrade -y \
    && dnf install -y \
      ca-certificates findutils git gzip iproute iptables-nft nftables procps-ng shadow-utils sudo tar util-linux wget xz \
    && dnf clean all \
    && curl --fail --silent --show-error --location \
      "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
      --output /tmp/node.tar.xz \
    && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum --check --strict \
    && tar -xJf /tmp/node.tar.xz --strip-components=1 -C /usr/local \
    && curl --fail --silent --show-error --location \
      "https://registry.npmjs.org/npm/-/npm-${NPM_VERSION}.tgz" \
      --output /tmp/npm.tgz \
    && echo "${NPM_SHA512}  /tmp/npm.tgz" | sha512sum --check --strict \
    && npm install --global /tmp/npm.tgz --ignore-scripts \
    && curl --fail --silent --show-error --location \
      "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_VERSION}.tgz" \
      --output /tmp/docker.tar.gz \
    && echo "${DOCKER_SHA256}  /tmp/docker.tar.gz" | sha256sum --check --strict \
    && tar -xzf /tmp/docker.tar.gz -C /tmp \
    && install -m 0755 /tmp/docker/docker /tmp/docker/docker-proxy /tmp/docker/dockerd /tmp/docker/containerd /tmp/docker/containerd-shim-runc-v2 /tmp/docker/runc /usr/local/bin/ \
    && mkdir -p /usr/local/lib/docker/cli-plugins \
    && curl --fail --silent --show-error --location \
      "https://github.com/docker/compose/releases/download/v${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
      --output /usr/local/lib/docker/cli-plugins/docker-compose \
    && echo "${COMPOSE_SHA256}  /usr/local/lib/docker/cli-plugins/docker-compose" | sha256sum --check --strict \
    && chmod 0755 /usr/local/lib/docker/cli-plugins/docker-compose \
    && rm -rf /tmp/node.tar.xz /tmp/npm.tgz /tmp/docker /tmp/docker.tar.gz

COPY --chmod=0755 --from=buildx /buildx /usr/local/lib/docker/cli-plugins/docker-buildx

RUN groupadd --system blame-runtime \
    && useradd --system --create-home --gid blame-runtime --shell /usr/sbin/nologin blame-control \
    && useradd --system --create-home --gid blame-runtime --shell /bin/bash blame-project \
    && mkdir -p /opt/blame /workspace /var/lib/blame /var/log/blame \
    && chown blame-project:blame-runtime /workspace \
    && chmod 2770 /workspace \
    && chmod 0700 /var/lib/blame /var/log/blame

WORKDIR /opt/blame
COPY packages/sandbox-runner/package.json ./package.json
COPY packages/sandbox-runner/dist/blame-sandbox-runner.cjs ./dist/blame-sandbox-runner.cjs
RUN mkdir -p /opt/blame/bin \
    && ln -sf /opt/blame/dist/blame-sandbox-runner.cjs /opt/blame/bin/blame-sandbox-runner \
    && ln -sf /opt/blame/dist/blame-sandbox-runner.cjs /opt/blame/bin/blame-runnerctl \
    && chmod 0755 /opt/blame/dist/blame-sandbox-runner.cjs

ENV BLAME_RUNNER_VERSION=${BLAME_RUNNER_VERSION}
ENV BLAME_RUNNER_IMAGE_DIGEST=${BLAME_RUNNER_IMAGE_DIGEST}
ENV PATH="/opt/blame/bin:${PATH}"

# The trusted supervisor owns dockerd and the control-plane state. Compose
# pins every project container to an unprivileged identity and never exposes
# the daemon socket to project services.
USER root
WORKDIR /workspace
