# Preview runtime operations

The managed preview runtime is disabled unless `BLAME_CLOUD_RUNTIME_ENABLED=true`.
Vercel credentials, the Preview Edge control token, and the capability signing
private key belong only in the server secret manager. They must never be added to
the desktop build or runner image.

`ATTACHMENTS_S3_KMS_KEY_ID` is mandatory outside tests. Workspace uploads and
deltas use SSE-KMS with the preview session ID as encryption context; the bucket
CORS policy must allow the signed checksum and SSE-KMS request headers.

`BLAME_SANDBOX_DEPLOYMENT_ID` must be a stable, environment-specific identifier.
The provider sweeper only deletes `blame-` sandboxes carrying the matching
deployment tag and older than its one-hour anti-race grace period.

Run the reaper independently of the desktop and API request workers at least once
per minute:

```sh
node ace.js previews:reap --limit=50
```

Alert on a non-zero exit and retry. The command is idempotent: each reaper action
uses the durable session revision and generation as its operation key. A failed
delta export keeps the host recoverable and is retried; it does not delete the
sandbox.

Run the durable checkpoint command from a dedicated worker every
`BLAME_PREVIEW_RPO_SECONDS` (the API clamps this value to 10 seconds):

```sh
node ace.js previews:checkpoint --limit=50
```

The scheduler must retry failures before the next interval. A checkpoint is a
no-op when the runner journal revision has not advanced, so overlapping scheduler
ticks are safe behind the per-session distributed lock.

`BLAME_CLOUD_RUNTIME_ENABLED=false` is the global kill switch.
`BLAME_PREVIEW_DISABLED_TENANT_IDS` is a comma-separated tenant/user denylist.
The per-tenant and global monthly budgets stop all new starts and resumes. The
checkpoint worker also suspends already-running sessions within the configured
RPO interval, while leaving export and destruction available for recovery.

The release command requires Docker Buildx, Grype, and Cosign. Buildx publishes
SPDX SBOM and SLSA provenance attestations, Grype blocks critical findings, and
Cosign signs the immutable digest (keyless OIDC or the configured Cosign key).

Before enabling a runner digest:

1. build `packages/sandbox-runner/Dockerfile` for `linux/amd64`;
2. run `pnpm release:sandbox-runner` to attest, scan, sign, and push it to VCR;
3. archive the Grype result and verify the Cosign signature in the deployment policy;
4. run the runtime contract and canary suites;
5. configure the immutable `@sha256:` reference;
6. keep the previous digest available for rollback.
