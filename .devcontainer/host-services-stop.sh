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
  if kill "$pid" 2>/dev/null; then
    echo "stopped $name (pid $pid)"
  else
    echo "$name (pid $pid) was not running, removed stale pidfile"
  fi
  rm -f "$f"
done

echo "${#pidfiles[@]} service(s) processed"
