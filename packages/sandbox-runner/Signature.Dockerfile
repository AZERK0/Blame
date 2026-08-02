FROM scratch

ARG BLAME_SIGNED_IMAGE
LABEL org.opencontainers.image.title="Blame sandbox runner Sigstore bundle" \
      dev.sigstore.bundle.subject="${BLAME_SIGNED_IMAGE}"

COPY signature.sigstore.json /signature.sigstore.json
