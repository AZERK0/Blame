#!/bin/sh
set -eu

vm_name="BlameRuntime"
runtime_home="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
manifest_path="$runtime_home/manifest.json"
runtime_version="$(sed -n 's/.*"runtimeVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest_path" | head -n 1)"
runtime_version="${runtime_version:-1}"
lima_state_home="${LIMA_HOME:-$HOME/Library/Application Support/Blame/runtime/lima}"
lima_action="Package bundled Lima resources with Blame, then run Blame runtime setup again."
vm_action="Create or repair the BlameRuntime Lima VM from Blame runtime setup."
repair_action="Repair BlameRuntime from Blame runtime setup."

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

new_check() {
  name="$(json_escape "$1")"
  status="$(json_escape "$2")"
  action="${3:-}"
  if [ -n "$action" ]; then
    printf '{"name":"%s","status":"%s","action":"%s"}' "$name" "$status" "$(json_escape "$action")"
  else
    printf '{"name":"%s","status":"%s"}' "$name" "$status"
  fi
}

append_check() {
  check="$1"
  if [ -n "${checks:-}" ]; then
    checks="$checks,$check"
  else
    checks="$check"
  fi
}

write_status() {
  status="$1"
  action="${2:-}"
  if [ -n "$action" ]; then
    printf '{"status":"%s","checks":[%s],"action":"%s"}\n' "$(json_escape "$status")" "${checks:-}" "$(json_escape "$action")"
  else
    printf '{"status":"%s","checks":[%s]}\n' "$(json_escape "$status")" "${checks:-}"
  fi
}

limactl_path() {
  if [ -n "${BLAME_LIMA_BIN:-}" ] && [ -x "$BLAME_LIMA_BIN" ]; then
    printf '%s' "$BLAME_LIMA_BIN"
    return
  fi
  if [ -n "${BLAME_LIMA_BIN_DIR:-}" ] && [ -x "$BLAME_LIMA_BIN_DIR/limactl" ]; then
    printf '%s' "$BLAME_LIMA_BIN_DIR/limactl"
    return
  fi
  if [ -n "${BLAME_LIMA_BUNDLE_DIR:-}" ] && [ -x "$BLAME_LIMA_BUNDLE_DIR/bin/limactl" ]; then
    printf '%s' "$BLAME_LIMA_BUNDLE_DIR/bin/limactl"
    return
  fi
  if [ -x "$runtime_home/lima/bin/limactl" ]; then
    printf '%s' "$runtime_home/lima/bin/limactl"
  fi
}

with_lima_environment() {
  limactl="$(limactl_path)"
  if [ -z "$limactl" ]; then
    return 1
  fi
  export LIMA_HOME="$lima_state_home"
  export PATH="$(dirname "$limactl"):$PATH"
  "$limactl" "$@"
}

test_lima_available() {
  with_lima_environment --version >/dev/null 2>&1
}

vm_json() {
  with_lima_environment list --json "$vm_name" 2>/dev/null || true
}

vm_status() {
  vm_json | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

test_vm_present() {
  [ -n "$(vm_json)" ]
}

test_vm_running() {
  [ "$(vm_status)" = "Running" ]
}

run_vm_root_test() {
  command="$1"
  with_lima_environment shell "$vm_name" sudo -n sh -lc "$command" >/dev/null 2>&1
}

add_vm_checks() {
  add_runtime_check "agent" "test -x /usr/local/bin/blame-runtime-agent"
  add_runtime_check "containerd" "command -v containerd >/dev/null 2>&1 && (pgrep -x containerd >/dev/null 2>&1 || containerd --version >/dev/null 2>&1)"
  add_runtime_check "nerdctl" "command -v nerdctl >/dev/null 2>&1"
  add_runtime_check "nerdctl-compose" "nerdctl compose version >/dev/null 2>&1"
  add_runtime_check "git" "command -v git >/dev/null 2>&1"
}

add_runtime_check() {
  name="$1"
  command="$2"
  status="$(runtime_check_status "$command")"
  if [ "$status" = "available" ]; then
    append_check "$(new_check "$name" "$status")"
  else
    append_check "$(new_check "$name" "$status" "$repair_action")"
  fi
}

runtime_check_status() {
  if run_vm_root_test "$1"; then
    printf '%s' "available"
  else
    printf '%s' "missing"
  fi
}

runtime_status() {
  checks=""
  if ! test_lima_available; then
    append_check "$(new_check "lima" "missing" "$lima_action")"
    write_status "missing" "$lima_action"
    return
  fi
  append_check "$(new_check "lima" "available")"
  if ! test_vm_present; then
    append_check "$(new_check "vm" "missing" "$vm_action")"
    write_status "missing" "$vm_action"
    return
  fi
  if ! test_vm_running; then
    append_check "$(new_check "vm" "unavailable" "$vm_action")"
    write_status "repairable" "$vm_action"
    return
  fi
  append_check "$(new_check "vm" "available")"
  add_vm_checks
  if printf '%s' "$checks" | grep -q '"status":"missing"'; then
    write_status "repairable" "$repair_action"
    return
  fi
  write_status "ready"
}

assert_lima_available() {
  if test_lima_available; then
    return
  fi
  printf '%s\n' "$lima_action" >&2
  exit 1
}

ensure_vm() {
  assert_lima_available
  mkdir -p "$lima_state_home"
  if ! test_vm_present; then
    with_lima_environment create --name "$vm_name" --tty=false "$runtime_home/lima/blame-runtime.yaml"
  fi
  if ! test_vm_running; then
    with_lima_environment start "$vm_name"
  fi
}

invoke_provisioner() {
  provisioner="$runtime_home/scripts/provision-blame-runtime.sh"
  with_lima_environment shell "$vm_name" sudo -n sh -s -- "$runtime_version" <"$provisioner"
}

ensure_runtime() {
  ensure_vm
  invoke_provisioner
  runtime_status
}

reset_runtime() {
  assert_lima_available
  if test_vm_present; then
    with_lima_environment delete -f "$vm_name"
  fi
  ensure_runtime
}

uninstall_runtime() {
  assert_lima_available
  if test_vm_present; then
    with_lima_environment delete -f "$vm_name"
  fi
  runtime_status
}

invoke_runtime_command() {
  if ! test_vm_present; then
    printf '%s\n' "BlameRuntime is not installed." >&2
    exit 1
  fi
  user="blame"
  case "${1:-}" in
    compose | container | info | inspect | network | volume)
      user="root"
      ;;
    sh)
      case " $* " in
        *" nerdctl "*) user="root" ;;
      esac
      ;;
  esac
  if [ "$user" = "root" ]; then
    with_lima_environment shell "$vm_name" sudo -n -- "$@"
    exit $?
  fi
  with_lima_environment shell "$vm_name" sudo -n -u blame -- "$@"
  exit $?
}

if [ "$#" -eq 0 ]; then
  runtime_status
  exit 0
fi

case "$1" in
  --version)
    printf '%s\n' "blame-lima-runtime $runtime_version"
    ;;
  status)
    runtime_status
    ;;
  ensure)
    ensure_runtime
    ;;
  repair)
    ensure_runtime
    ;;
  reset)
    reset_runtime
    ;;
  uninstall)
    uninstall_runtime
    ;;
  *)
    invoke_runtime_command "$@"
    ;;
esac
