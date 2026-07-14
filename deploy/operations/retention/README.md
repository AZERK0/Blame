# Production retention controls

These files are production configuration templates. Committing them does not change OVHcloud, Docker, Dokploy, or the host. An operator must apply every relevant control and verify it after every infrastructure or Dokploy change.

## OVHcloud backup rotation

Use a private, dedicated OVHcloud S3-compatible bucket in the approved Gravelines region containing only Blame backups. The lifecycle file targets the whole bucket. It expires current objects after 80 days, removes noncurrent data versions after one additional day, removes expired delete markers, and abandons incomplete uploads after seven days. The margin accommodates lifecycle processing before the 90-day maximum. Use the bucket's `.io` endpoint because OVHcloud does not support lifecycle rules on the legacy `.perf` endpoint.

Apply and read back the lifecycle configuration:

```sh
aws --endpoint-url "$OVH_S3_ENDPOINT" s3api put-bucket-lifecycle-configuration \
  --bucket "$BLAME_BACKUP_BUCKET" \
  --lifecycle-configuration file://"$PWD/deploy/operations/retention/ovh-s3-backup-lifecycle.json"

aws --endpoint-url "$OVH_S3_ENDPOINT" s3api get-bucket-lifecycle-configuration \
  --bucket "$BLAME_BACKUP_BUCKET"
```

In Dokploy, select this dedicated bucket for every Blame database, volume, and web-server backup. Run a test backup and a restore test. Inventory OVH snapshots, database-managed backups, replicas, exports, and any second destination; disable them or independently cap them at 90 days. Object Lock, legal holds, and versioning settings must not preserve backup data past the approved period unless a documented legal hold applies. OVHcloud lifecycle execution is asynchronous, so audit object ages regularly and lower the 80-day trigger if any object approaches 90 days.

Until the dedicated OVH Object Storage destination is configured, the host creates a daily encrypted MySQL dump in `/var/backups/blame/mysql` and deletes dump and checksum files after 80 days. The encryption key is generated once at `/etc/blame/backup.key`; copy it to an approved offline secret store because a server loss otherwise makes the local backups unrecoverable. This local rotation enforces the retention ceiling but is not an off-host disaster-recovery copy.

## Account closure ledger and restore barrier

Set `ACCOUNT_CLOSURE_LEDGER_DIRECTORY=/var/lib/blame/account-closure-ledger` in the API production environment. Mount that exact directory as durable, encrypted storage shared by every API task that can serve the same database. It must remain outside the MySQL backup dataset so restoring an older database cannot remove a later closure tombstone. Restrict the directory to the API runtime identity, replicate its immutable records to a separate private Gravelines destination, and retain each record for the five-year rights-request period or ten-year billing-evidence period encoded by the service.

The API writes and synchronises each tombstone before active deletion. Authentication checks the ledger as well as MySQL, and the hourly purge command reconciles any user resurrected by a database restore. If the ledger cannot be written, account access remains disabled and deletion is retried without falsely reporting active deletion as complete.

Never expose a restored database directly to users. Keep ingress disabled, attach the latest closure ledger, migrate the database, and run the reconciliation command inside the restored API container:

```sh
node ace migration:run --force
node ace accounts:purge-closed
node ace accounts:purge-closed
```

The first run must complete successfully and report every reconciled closure. The second must report zero restored closures and zero deadline breaches. Confirm that sampled closed user identifiers cannot authenticate, then reopen ingress. Treat a missing ledger, an invalid record, or any command failure as a restore blocker.

## Account purge and Dokploy log retention

The hourly host job runs `node ace accounts:purge-closed` in one running API container and deletes only regular `*.log` files older than 350 days from Dokploy's documented log directories. It also removes rotated Traefik `access.log-*` and `access.log.*` files older than 350 days, including when the active access log is empty or no longer exists. It does not follow symlinks or cross filesystems. The service fails if Docker, the API target, or the account-purge command is unavailable.

Install the job from the repository root:

```sh
sudo install -D -m 0750 deploy/operations/retention/bin/blame-run-retention \
  /usr/local/sbin/blame-run-retention
sudo install -D -m 0750 deploy/operations/retention/bin/blame-purge-closed-accounts \
  /usr/local/sbin/blame-purge-closed-accounts
sudo install -D -m 0750 deploy/operations/retention/bin/blame-prune-dokploy-logs \
  /usr/local/sbin/blame-prune-dokploy-logs
sudo install -D -m 0750 deploy/operations/retention/bin/blame-ensure-runtime-retention \
  /usr/local/sbin/blame-ensure-runtime-retention
sudo install -D -m 0750 deploy/operations/retention/bin/blame-prune-docker-containers \
  /usr/local/sbin/blame-prune-docker-containers
sudo install -D -m 0750 deploy/operations/retention/bin/blame-backup-mysql \
  /usr/local/sbin/blame-backup-mysql
sudo install -D -m 0600 deploy/operations/retention/blame-retention.env.example \
  /etc/blame/retention.env
sudo sh -c 'test -s /etc/blame/backup.key || (umask 077 && openssl rand -base64 48 > /etc/blame/backup.key)'
sudo install -D -m 0644 deploy/operations/retention/systemd/blame-retention.service \
  /etc/systemd/system/blame-retention.service
sudo install -D -m 0644 deploy/operations/retention/systemd/blame-retention.timer \
  /etc/systemd/system/blame-retention.timer
sudo install -D -m 0644 deploy/operations/retention/systemd/blame-backup.service \
  /etc/systemd/system/blame-backup.service
sudo install -D -m 0644 deploy/operations/retention/systemd/blame-backup.timer \
  /etc/systemd/system/blame-backup.timer
sudo install -D -m 0644 deploy/operations/retention/logrotate/blame-traefik-access \
  /etc/logrotate.d/blame-traefik-access
```

Find the stable Dokploy Swarm service name with `docker service ls` and set `BLAME_API_SERVICE` in `/etc/blame/retention.env`. Leave `BLAME_API_CONTAINER` empty. For a non-Swarm deployment, leave the service value empty and set the exact running container name instead; update it after every replacement. Setting both or neither makes the job fail.

Test and enable the timer:

```sh
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/blame-retention.service \
  /etc/systemd/system/blame-retention.timer
sudo systemctl start blame-retention.service
sudo systemctl status blame-retention.service
sudo journalctl -u blame-retention.service --since today
sudo systemctl enable --now blame-retention.timer
systemctl list-timers blame-retention.timer
sudo systemctl start blame-backup.service
sudo systemctl enable --now blame-backup.timer
systemctl list-timers blame-backup.timer
```

Confirm hourly successful account-purge output, connect unit failures to host alerting, and investigate every failed unit immediately. Do not create a second Dokploy schedule for the same purge command while this timer is active.

Install and validate `logrotate` before enabling Dokploy Requests:

```sh
sudo logrotate --debug /etc/logrotate.d/blame-traefik-access
```

Enable Requests for a controlled test, apply or reload Traefik as required by Dokploy, and send a request through the public Traefik endpoint. Continue only if the active log exists and contains the test request:

```sh
sudo test -s /etc/dokploy/traefik/dynamic/access.log
sudo chmod 0640 /etc/dokploy/traefik/dynamic/access.log
sudo logrotate --force /etc/logrotate.d/blame-traefik-access
sudo find /etc/dokploy/traefik/dynamic -maxdepth 1 -type f \
  -name 'access.log-*' -print
```

Send another request after the forced rotation and confirm that `access.log` receives it. Disable Requests immediately if the active log, rotation, or post-rotation write test fails. After a successful test, enable and verify daily rotation:

```sh
sudo systemctl enable --now logrotate.timer
systemctl list-timers logrotate.timer
```

The hourly Blame retention job independently deletes stale rotated files, so they still expire if Requests is later disabled or the active log remains empty.

## Journald maximum

Install the host drop-in and enforce the initial cutoff:

```sh
sudo install -D -m 0644 deploy/operations/retention/journald/90-blame-retention.conf \
  /etc/systemd/journald.conf.d/90-blame-retention.conf
sudo systemctl restart systemd-journald
sudo journalctl --rotate
sudo journalctl --vacuum-time=350days
systemd-analyze cat-config systemd/journald.conf
```

Configure the Blame services in Dokploy to use Docker's `journald` log driver, then recreate their containers. Verify every relevant running container instead of assuming the Docker default applies:

```sh
docker inspect --format '{{.Name}} {{.HostConfig.LogConfig.Type}}' $(docker ps -q)
journalctl --disk-usage
```

The Dokploy file-prune job intentionally does not truncate Docker `json-file` logs. Any Blame container still using `json-file`, alternate Traefik access-log destination, Dokploy audit or job log stored in PostgreSQL, database-engine error, general or audit log, syslog, monitoring store, external log collector, or OVH service log is outside the journald limit. Configure each such external store to a maximum of 12 months or disable it, and verify the oldest retained event during the regular retention audit.

Time-based deletion does not cap the volume generated within the retention window. Keep host and bucket capacity alerts active, and keep Dokploy Requests disabled if the server cannot safely absorb and rotate the observed access-log volume.
