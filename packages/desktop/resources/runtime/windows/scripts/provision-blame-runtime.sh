set -eu

runtime_version="${1:-1}"
runtime_root="/home/blame/.local/share/blame/runtime"
nerdctl_version="${BLAME_NERDCTL_VERSION:-2.1.6}"

ensure_user() {
  if id blame >/dev/null 2>&1; then
    return
  fi
  useradd --create-home --shell /bin/bash blame
}

ensure_packages() {
  if ! command -v apt-get >/dev/null 2>&1; then
    return
  fi
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl dbus-user-session git gzip iptables slirp4netns tar uidmap xz-utils
}

runtime_architecture() {
  case "$(uname -m)" in
    x86_64 | amd64) printf '%s' "amd64" ;;
    aarch64 | arm64) printf '%s' "arm64" ;;
    *) uname -m ;;
  esac
}

ensure_nerdctl_full() {
  if command -v nerdctl >/dev/null 2>&1 && command -v buildkitd >/dev/null 2>&1 && [ -x /opt/cni/bin/bridge ]; then
    return
  fi
  arch="$(runtime_architecture)"
  archive="nerdctl-full-${nerdctl_version}-linux-${arch}.tar.gz"
  url="https://github.com/containerd/nerdctl/releases/download/v${nerdctl_version}/${archive}"
  temp_dir="$(mktemp -d)"
  curl -fsSL "$url" -o "$temp_dir/$archive"
  tar -C /usr/local -xzf "$temp_dir/$archive"
  rm -rf "$temp_dir"
}

ensure_runtime_paths() {
  mkdir -p \
    "$runtime_root/repos" \
    "$runtime_root/worktrees" \
    "$runtime_root/caches" \
    "$runtime_root/logs" \
    "$runtime_root/env"
  chown -R blame:blame /home/blame/.local
}

ensure_containerd_config() {
  mkdir -p /etc/containerd /var/lib/containerd /run/containerd
  if [ ! -s /etc/containerd/config.toml ] && command -v containerd >/dev/null 2>&1; then
    containerd config default >/etc/containerd/config.toml
  fi
}

ensure_containerd_running() {
  if pgrep -x containerd >/dev/null 2>&1; then
    return
  fi
  mkdir -p /var/log/blame-runtime
  nohup containerd >/var/log/blame-runtime/containerd.log 2>&1 &
  sleep 2
}

ensure_agent() {
  cat >/usr/local/bin/blame-runtime-agent <<'EOF'
#!/bin/sh
set -eu
case "${1:-status}" in
  status)
    printf '%s\n' "ready"
    ;;
  version)
    cat /etc/blame-runtime-version
    ;;
  *)
    exec "$@"
    ;;
esac
EOF
  chmod 755 /usr/local/bin/blame-runtime-agent
}

write_marker() {
  printf '%s\n' "$runtime_version" >/etc/blame-runtime-version
}

ensure_user
ensure_packages
ensure_nerdctl_full
ensure_runtime_paths
ensure_containerd_config
ensure_containerd_running
ensure_agent
write_marker
