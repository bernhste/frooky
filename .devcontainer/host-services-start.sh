#!/usr/bin/env bash
set -euo pipefail

APPIUM_PORT=4723
FRIDA_PORT=27042
ADB_PORT=5037
PORTS=("$APPIUM_PORT" "$FRIDA_PORT" "$ADB_PORT")

TMP_BASE="${TMPDIR:-/tmp}"
LOG_DIR="${TMP_BASE%/}/frooky"        # macOS TMPDIR has a trailing slash
PID_DIR="$LOG_DIR/pid"
mkdir -p "$LOG_DIR" "$PID_DIR"

cat <<EOF
┌──────────────────────────────────────────────────────────┐
│  frooky host services - run on the HOST, used by tests   │
├──────────────────────────────────────────────────────────┤
$(printf '│    %-13s %-6s %-32s │\n' adb          ":$ADB_PORT"    "device access, owns USB")
$(printf '│    %-13s %-6s %-32s │\n' appium       ":$APPIUM_PORT" "UI automation")
$(printf '│    %-13s %-6s %-32s │\n' frida-server ":$FRIDA_PORT"  "instrumentation")
└──────────────────────────────────────────────────────────┘
EOF

listening() { (exec 3<>"/dev/tcp/$1/$2") 2>/dev/null; }

# echoes the pid if the recorded process is alive, else clears the stale file
running() {
  local pidfile="$PID_DIR/$1.pid" pid
  [ -f "$pidfile" ] || return 1
  pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    echo "$pid"
    return 0
  fi
  rm -f "$pidfile"
  return 1
}

# initializeCommand blocks VS Code until it returns -> everything detaches
spawn() {
  local name=$1 endpoint=$2; shift 2
  local host=${endpoint%:*} port=${endpoint##*:} pid

  if pid=$(running "$name"); then
    echo "$name (pid $pid) already running on $endpoint"
    return 0
  fi

  if listening "$host" "$port"; then
    echo "$name already running on $endpoint (started outside this script)"
    return 0
  fi

  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: $1 not installed or not on PATH - $name not started" >&2
    return 0
  fi

  nohup "$@" >"$LOG_DIR/$name.log" 2>&1 &
  pid=$!
  echo "$pid" >"$PID_DIR/$name.pid"
  disown
  sleep 0.3
  if kill -0 "$pid" 2>/dev/null; then
    echo "$name (pid $pid) started and listening on $endpoint"
  else
    rm -f "$PID_DIR/$name.pid"
    echo "ERROR: $name failed to start, see $LOG_DIR/$name.log" >&2
    tail -n 5 "$LOG_DIR/$name.log" >&2
  fi
}

# --- host services, loopback only ------------------------------------
# adb daemonizes itself, so no spawn()
if listening 127.0.0.1 "$ADB_PORT"; then
  echo "adb server already running on 127.0.0.1:$ADB_PORT"
elif ! command -v adb >/dev/null 2>&1; then
  echo "ERROR: adb not installed or not on PATH - adb server not started" >&2
elif adb start-server >/dev/null 2>&1; then
  pid=$(pgrep -f 'fork-server server' | head -n1)
  echo "adb server (pid ${pid:-?}) started and listening on 127.0.0.1:$ADB_PORT"
else
  echo "ERROR: adb start-server failed" >&2
fi

spawn appium "127.0.0.1:$APPIUM_PORT" \
  appium --address 127.0.0.1 \
         --port "$APPIUM_PORT" \
         --allow-insecure=uiautomator2:adb_shell

spawn frida-server "127.0.0.1:$FRIDA_PORT" \
  frida-server -l "127.0.0.1:$FRIDA_PORT"

# --- linux only: relay docker bridge gateway -> loopback --------------
[ "$(uname -s)" = "Linux" ] || exit 0   # Docker Desktop reaches host loopback itself

GATEWAY=$(docker network inspect bridge \
  -f '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || true)
GATEWAY=${GATEWAY:-172.17.0.1}

command -v socat >/dev/null || { echo "socat not installed on host" >&2; exit 1; }

for port in "${PORTS[@]}"; do
  spawn "relay-$port" "$GATEWAY:$port" socat \
    "TCP-LISTEN:$port,reuseaddr,fork,bind=$GATEWAY" \
    "TCP:127.0.0.1:$port"
done
