#!/usr/bin/env bash
set -euo pipefail

TMP_BASE="${TMPDIR:-/tmp}"
PID_DIR="${TMP_BASE%/}/frooky/pid"

shopt -s nullglob
pidfiles=("$PID_DIR"/*.pid)

if [ ${#pidfiles[@]} -eq 0 ]; then
  echo "no frooky host services recorded in $PID_DIR"
  exit 0
fi

for f in "${pidfiles[@]}"; do
  name=$(basename "$f" .pid)
  pid=$(cat "$f")
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for _ in {1..20}; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
      echo "force-stopped $name (pid $pid)"
    else
      echo "stopped $name (pid $pid)"
    fi
  else
    echo "$name (pid $pid) was not running, removed stale pidfile"
  fi
  rm -f "$f"
done

echo "${#pidfiles[@]} service(s) processed"
