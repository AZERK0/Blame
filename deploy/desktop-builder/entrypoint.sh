#!/bin/sh
set -eu

release_root="${BLAME_RELEASE_ROOT:-/downloads}"
release_version="${BLAME_VERSION:-local}"
release_uid="${BLAME_RELEASE_UID:-1000}"
release_gid="${BLAME_RELEASE_GID:-1000}"
versioned_release_path="$release_root/releases/$release_version"
latest_release_path="$release_root/latest"

mkdir -p "$versioned_release_path" "$latest_release_path"
chown "$release_uid:$release_gid" "$release_root" "$release_root/releases" "$versioned_release_path" "$latest_release_path"
rm -f "$versioned_release_path"/blame-linux-* "$versioned_release_path"/*-linux.yml
rm -f "$latest_release_path"/blame-linux-* "$latest_release_path"/*-linux.yml
cp -a /release-files/. "$versioned_release_path/"
cp -a /release-files/. "$latest_release_path/"
chown -R "$release_uid:$release_gid" "$versioned_release_path" "$latest_release_path"

exec "$@"
