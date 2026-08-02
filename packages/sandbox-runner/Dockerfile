FROM --platform=linux/amd64 amazonlinux:2023.12.20260710.0@sha256:2d3d063f7fc9fed492a1a7286a88f9852e9b391aa7a6fe91dedbb8381e0bb5b0

ARG NODE_VERSION=24.5.0
ARG NODE_SHA256=32edb1f2aeaf8ea0d484af33bf3b5d8330d7d33c9cd8c70f811b8a643822e613
ARG DOCKER_VERSION=28.3.3
ARG DOCKER_SHA256=40c16bcf324f354b382d07e845e6a79e3493fc0c09b252dff9e1a46125589bff
ARG COMPOSE_VERSION=2.39.1
ARG COMPOSE_SHA256=a5ea28722d5da628b59226626f7d6c33c89a7ed19e39f750645925242044c9d2
ARG BLAME_RUNNER_VERSION=0.1.0
ARG BLAME_RUNNER_IMAGE_DIGEST=sha256:development

RUN dnf install -y \
      ca-certificates curl findutils git gzip iproute procps-ng shadow-utils tar util-linux wget xz \
    && dnf clean all \
    && curl --fail --silent --show-error --location \
      "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
      --output /tmp/node.tar.xz \
    && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum --check --strict \
    && tar -xJf /tmp/node.tar.xz --strip-components=1 -C /usr/local \
    && curl --fail --silent --show-error --location \
      "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_VERSION}.tgz" \
      --output /tmp/docker.tar.gz \
    && echo "${DOCKER_SHA256}  /tmp/docker.tar.gz" | sha256sum --check --strict \
    && tar -xzf /tmp/docker.tar.gz -C /tmp \
    && install -m 0755 /tmp/docker/docker /tmp/docker/dockerd /tmp/docker/containerd /tmp/docker/containerd-shim-runc-v2 /tmp/docker/runc /usr/local/bin/ \
    && mkdir -p /usr/local/lib/docker/cli-plugins \
    && curl --fail --silent --show-error --location \
      "https://github.com/docker/compose/releases/download/v${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
      --output /usr/local/lib/docker/cli-plugins/docker-compose \
    && echo "${COMPOSE_SHA256}  /usr/local/lib/docker/cli-plugins/docker-compose" | sha256sum --check --strict \
    && chmod 0755 /usr/local/lib/docker/cli-plugins/docker-compose \
    && rm -rf /tmp/node.tar.xz /tmp/docker /tmp/docker.tar.gz

RUN groupadd --system blame-runtime \
    && useradd --system --create-home --gid blame-runtime --shell /usr/sbin/nologin blame-control \
    && useradd --system --create-home --gid blame-runtime --shell /bin/bash blame-project \
    && mkdir -p /opt/blame /workspace /var/lib/blame /var/log/blame \
    && chown blame-project:blame-runtime /workspace \
    && chmod 2770 /workspace \
    && chmod 0700 /var/lib/blame /var/log/blame

WORKDIR /opt/blame
COPY packages/sandbox-runner/package.json ./package.json
COPY packages/sandbox-runner/dist/blame-sandbox-runner.js ./dist/blame-sandbox-runner.js
RUN mkdir -p /opt/blame/bin \
    && ln -sf /opt/blame/dist/blame-sandbox-runner.js /opt/blame/bin/blame-sandbox-runner \
    && ln -sf /opt/blame/dist/blame-sandbox-runner.js /opt/blame/bin/blame-runnerctl \
    && chmod 0755 /opt/blame/dist/blame-sandbox-runner.js

ENV BLAME_RUNNER_VERSION=${BLAME_RUNNER_VERSION}
ENV BLAME_RUNNER_IMAGE_DIGEST=${BLAME_RUNNER_IMAGE_DIGEST}
ENV PATH="/opt/blame/bin:${PATH}"

# The trusted supervisor must own dockerd, the control-plane state and the
# privilege drop performed for native project processes. Project code never
# runs as this user: ProcessSupervisor sets uid/gid to blame-project and
# Compose pins every project container to the same unprivileged identity.
USER root
WORKDIR /workspace
