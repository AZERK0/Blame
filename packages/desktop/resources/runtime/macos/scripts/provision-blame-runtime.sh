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
  apt-get install -y ca-certificates curl dbus-user-session git gzip iptables python3 slirp4netns tar uidmap xz-utils
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
#!/usr/bin/env python3
import json
import os
import pwd
import subprocess
import sys
import threading
import uuid

processes = {}
write_lock = threading.Lock()
ignored_env_directories = {".git", ".blame", "build", "coverage", "dist", "node_modules", "out"}
env_template_suffixes = (".example", ".sample", ".template")

def write(value):
    with write_lock:
        sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
        sys.stdout.flush()

def version():
    try:
        with open("/etc/blame-runtime-version", "r", encoding="utf-8") as file:
            return file.read().strip()
    except OSError:
        return "unknown"

def ensure_containerd():
    if subprocess.run(["pgrep", "-x", "containerd"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
        return
    os.makedirs("/run/containerd", exist_ok=True)
    os.makedirs("/var/log/blame-runtime", exist_ok=True)
    log = open("/var/log/blame-runtime/containerd.log", "ab")
    subprocess.Popen(["containerd"], stdout=log, stderr=log, start_new_session=True)

def target_user(name):
    if name != "blame" or os.geteuid() != 0:
        return None
    account = pwd.getpwnam("blame")
    return account.pw_uid, account.pw_gid

def demote(user):
    if not user:
        return None
    uid, gid = user
    def apply():
        os.setgid(gid)
        os.setuid(uid)
    return apply

def clean_env(values):
    env = os.environ.copy()
    for key, value in values.items():
        if isinstance(key, str) and isinstance(value, str):
            env[key] = value
    return env

def command_env(params):
    return clean_env(params.get("env") or {})

def command_cwd(params):
    cwd = params.get("cwd")
    return cwd if isinstance(cwd, str) and cwd else None

def command_user(params):
    user = params.get("user")
    return user if user in ("blame", "root") else "blame"

def prepare_command(params):
    command = str(params.get("command") or "")
    args = [str(value) for value in params.get("args") or []]
    if command == "nerdctl":
        ensure_containerd()
    return command, args

def run_exec(params):
    command, args = prepare_command(params)
    timeout = params.get("timeoutMs")
    timeout_seconds = float(timeout) / 1000 if isinstance(timeout, (int, float)) else None
    process = subprocess.run(
        [command, *args],
        cwd=command_cwd(params),
        env=command_env(params),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout_seconds,
        preexec_fn=demote(target_user(command_user(params))),
    )
    result = {"stdout": process.stdout, "stderr": process.stderr, "code": process.returncode}
    if process.returncode != 0:
        raise CommandError(result)
    return result

class CommandError(Exception):
    def __init__(self, result):
        super().__init__("Runtime command failed")
        self.result = result

def stream_output(process_id, stream, stream_type):
    for chunk in iter(lambda: stream.readline(), ""):
        if chunk:
            write({"event": "spawn", "processId": process_id, "type": stream_type, "data": chunk})
    stream.close()

def wait_process(process_id, process):
    code = process.wait()
    processes.pop(process_id, None)
    write({"event": "spawn", "processId": process_id, "type": "exit", "code": code})

def run_spawn(params):
    command, args = prepare_command(params)
    process = subprocess.Popen(
        [command, *args],
        cwd=command_cwd(params),
        env=command_env(params),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        preexec_fn=demote(target_user(command_user(params))),
    )
    process_id = uuid.uuid4().hex
    processes[process_id] = process
    threading.Thread(target=stream_output, args=(process_id, process.stdout, "stdout"), daemon=True).start()
    threading.Thread(target=stream_output, args=(process_id, process.stderr, "stderr"), daemon=True).start()
    threading.Thread(target=wait_process, args=(process_id, process), daemon=True).start()
    return {"processId": process_id}

def run_kill(params):
    process_id = str(params.get("processId") or "")
    process = processes.get(process_id)
    if process and process.poll() is None:
        process.terminate()
    return {"stopped": bool(process)}

def runtime_env_file(name):
    if name != ".env" and not name.startswith(".env."):
        return False
    return not name.endswith(env_template_suffixes)

def template_env_file(name):
    return name.startswith(".env") and name.endswith(env_template_suffixes)

def run_scan_env_files(params):
    root = str(params.get("root") or "")
    runtime = []
    templates = []
    for directory, names, files in os.walk(root):
        names[:] = [name for name in names if name not in ignored_env_directories]
        for name in files:
            path = os.path.join(directory, name)
            if runtime_env_file(name):
                runtime.append(path)
            if template_env_file(name):
                templates.append(path)
    return {"runtime": runtime, "templates": templates}

def run_status():
    checks = {
        "version": version(),
        "python": True,
        "containerd": os.path.exists("/run/containerd/containerd.sock"),
        "git": subprocess.run(["sh", "-lc", "command -v git"], stdout=subprocess.DEVNULL).returncode == 0,
        "nerdctl": subprocess.run(["sh", "-lc", "command -v nerdctl"], stdout=subprocess.DEVNULL).returncode == 0,
    }
    return checks

methods = {
    "exec": run_exec,
    "spawn": run_spawn,
    "kill": run_kill,
    "scanEnvFiles": run_scan_env_files,
    "status": lambda params: run_status(),
}

def handle(request):
    request_id = request.get("id")
    method = methods.get(request.get("method"))
    if not method:
        write({"id": request_id, "ok": False, "error": {"message": "Unknown method"}})
        return
    try:
        write({"id": request_id, "ok": True, "result": method(request.get("params") or {})})
    except CommandError as error:
        write({"id": request_id, "ok": False, "error": {"message": str(error), **error.result}})
    except Exception as error:
        write({"id": request_id, "ok": False, "error": {"message": str(error)}})

def serve():
    for line in sys.stdin:
        try:
            handle(json.loads(line))
        except Exception as error:
            write({"id": 0, "ok": False, "error": {"message": str(error)}})

def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "status"
    if command == "status":
        print("ready")
    elif command == "version":
        print(version())
    elif command == "serve":
        serve()
    else:
        os.execvp(command, sys.argv[1:])

if __name__ == "__main__":
    main()
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
