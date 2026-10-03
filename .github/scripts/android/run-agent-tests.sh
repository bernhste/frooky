#!/usr/bin/env bash
# Runs the agent tests and, if they fail, saves the device log next to the results: the emulator is
# shut down after the runner's script, and a crash of the target process only shows up in logcat
# (frida-test reports it as "Script is destroyed").
set -uo pipefail

cd frooky/agent
npm run test:android -- -o test-results-agent-android.json
status=$?

if [ "$status" -ne 0 ]; then
  echo "Agent tests failed (exit $status), saving logcat to frooky/agent/logcat-agent-android.txt"
  {
    echo "===== crash buffer ====="
    adb logcat -d -b crash
    echo "===== tombstones ====="
    adb shell 'ls -l /data/tombstones/ 2>/dev/null; for f in $(ls -t /data/tombstones/tombstone_* 2>/dev/null | head -1); do cat "$f"; done'
    echo "===== main, system and events buffers ====="
    adb logcat -d -b main,system,events
  } > logcat-agent-android.txt 2>&1
fi

exit "$status"
