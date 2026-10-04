#!/usr/bin/env bash
# Runs frida-test on an Android device, choosing it like adb: -s <serial>, else $ANDROID_SERIAL,
# else the only attached device. With -a/--all it runs once per attached device and fails if any run fails.
# All other arguments go to frida-test; with -a, `-o out.json` becomes `out-<serial>.json`.
# The tests run in $FRIDA_TEST_APP, else the Google dialer, else the AOSP one (e.g. Android 12 images).
# Written for bash 3.2 (macOS), so no mapfile and no `set -u` with empty arrays.
set -o pipefail

GOOGLE_DIALER="com.google.android.dialer"
AOSP_DIALER="com.android.dialer"

# Prints the app to run the tests in on the device with serial $1 (empty: unknown device)
test_app() {
  if [ -n "$FRIDA_TEST_APP" ]; then
    echo "$FRIDA_TEST_APP"
  elif [ -n "$1" ] && ! adb -s "$1" shell pm path "$GOOGLE_DIALER" 2>/dev/null | grep -q '^package:' \
    && adb -s "$1" shell pm path "$AOSP_DIALER" 2>/dev/null | grep -q '^package:'; then
    echo "$AOSP_DIALER"
  else
    echo "$GOOGLE_DIALER"
  fi
}

all=0
adb_serial=""
explicit_device=0
explicit_serial=""
expect=""  # the option whose value is the next argument: -s or -D
args=()
for arg in "$@"; do
  case "$expect" in
    -s) adb_serial="$arg"; expect=""; continue ;;
    -D) explicit_serial="$arg"; expect="" ;;
  esac
  case "$arg" in
    -a | --all) all=1 ;;
    -s | --serial) expect=-s ;;
    -D | --device) explicit_device=1; expect=-D; args+=("$arg") ;;
    -U | --usb | -R | --remote | -H | --host) explicit_device=1; args+=("$arg") ;;
    *) args+=("$arg") ;;
  esac
done

if [ "$expect" = "-s" ]; then
  echo "-s needs a serial, e.g. -s emulator-5554" >&2
  exit 2
fi
if [ -n "$adb_serial" ] && [ "$all" -eq 1 ]; then
  echo "-s can't be combined with -a" >&2
  exit 2
fi
if [ "$explicit_device" -eq 1 ]; then
  if [ "$all" -eq 1 ] || [ -n "$adb_serial" ]; then
    echo "-a and -s can't be combined with -D, -U, -R or -H" >&2
    exit 2
  fi
  exec npx frida-test -f "$(test_app "$explicit_serial")" "${args[@]}"
fi

devices=()
while read -r serial state; do
  [ "$state" = "device" ] && devices+=("$serial")
done < <(adb devices | tail -n +2)

if [ "$all" -eq 0 ]; then
  if [ -n "${adb_serial:-$ANDROID_SERIAL}" ]; then
    devices=("${adb_serial:-$ANDROID_SERIAL}")
  elif [ "${#devices[@]}" -eq 0 ]; then
    echo "No Android device attached (adb devices)" >&2
    exit 1
  elif [ "${#devices[@]}" -gt 1 ]; then
    echo "Several devices attached, pass -s <serial> (or set ANDROID_SERIAL) for one of them, or -a for all:" >&2
    printf '  %s\n' "${devices[@]}" >&2
    exit 1
  fi
  exec npx frida-test -D "${devices[0]}" -f "$(test_app "${devices[0]}")" ${args[@]+"${args[@]}"}
fi

if [ "${#devices[@]}" -eq 0 ]; then
  echo "No Android device attached (adb devices)" >&2
  exit 1
fi

# Inserts the serial before the extension of the -o/--out path, e.g. `out.json` -> `out-emulator-5554.json`
device_args() {
  local serial="$1" next_is_out=0 arg
  device_args_result=()
  for arg in ${args[@]+"${args[@]}"}; do
    if [ "$next_is_out" -eq 1 ]; then
      case "$arg" in
        *.*) arg="${arg%.*}-$serial.${arg##*.}" ;;
        *) arg="$arg-$serial" ;;
      esac
      next_is_out=0
    fi
    case "$arg" in -o | --out) next_is_out=1 ;; esac
    device_args_result+=("$arg")
  done
}

summary=()
failed=0
for serial in "${devices[@]}"; do
  version="$(adb -s "$serial" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r')"
  app="$(test_app "$serial")"
  echo "===== $serial (Android $version, $app) ====="
  device_args "$serial"
  if npx frida-test -D "$serial" -f "$app" ${device_args_result[@]+"${device_args_result[@]}"}; then
    summary+=("passed  $serial (Android $version)")
  else
    summary+=("FAILED  $serial (Android $version)")
    failed=1
  fi
done

echo "===== Summary ====="
printf '%s\n' "${summary[@]}"
exit "$failed"
