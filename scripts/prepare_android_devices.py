#!/usr/bin/env python3
"""Prepare attached Android devices for frooky development: root, frida-server, SELinux.

For each device: checks the adb connection, gets root (`adb root`, else `su`), sets SELinux
to permissive, installs the newest frida-server with the host frida's major version to
/data/local/tmp if it's missing, stops frida-servers of other versions, starts it, and checks
that frida reaches it. Within a major version, client and server are compatible, and newer
servers carry fixes for newer Android versions.

Usage: uv run scripts/prepare_android_devices.py [-s <serial> ...] [--frida-version <version>]

Without -s, prepares every device that `adb devices` lists (honoring ADB_SERVER_SOCKET).
Downloads are cached in ~/.cache/frooky/frida-server/.
"""

from __future__ import annotations

import argparse
import json
import lzma
import shlex
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import frida

DEVICE_DIR = "/data/local/tmp"
CACHE_DIR = Path.home() / ".cache" / "frooky" / "frida-server"
RELEASES_API = "https://api.github.com/repos/frida/frida/releases?per_page=50"
RELEASE_URL = "https://github.com/frida/frida/releases/download/{version}/frida-server-{version}-android-{arch}.xz"
ABI_TO_ARCH = {"arm64-v8a": "arm64", "armeabi-v7a": "arm", "armeabi": "arm", "x86_64": "x86_64", "x86": "x86"}
ADB_TIMEOUT = 30  # seconds
START_TIMEOUT = 10  # seconds


class PrepareError(Exception):
    pass


def adb(serial: str, *args: str, timeout: int = ADB_TIMEOUT) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["adb", "-s", serial, *args], capture_output=True, text=True, timeout=timeout)


class Device:
    def __init__(self, serial: str) -> None:
        self.serial = serial
        self.su = ""  # e.g. `su -c`; empty when adbd itself runs as root

    def shell(self, cmd: str, root: bool = False) -> str:
        """Runs cmd in the device shell and returns its stdout; root wraps it in su if adbd isn't root."""
        if root and self.su:
            cmd = f"{self.su} {shlex.quote(cmd)}"
        return adb(self.serial, "shell", cmd).stdout.replace("\r", "").strip()

    def check_connection(self) -> str:
        state = adb(self.serial, "get-state").stdout.strip()
        if state != "device":
            raise PrepareError(f"adb state is '{state or 'unknown'}', expected 'device'")
        return f"connected, Android {self.shell('getprop ro.build.version.release')}, {self.shell('getprop ro.product.cpu.abi')}"

    def ensure_root(self) -> str:
        if self.shell("id -u") == "0":
            return "adbd runs as root"
        result = adb(self.serial, "root")
        adb(self.serial, "wait-for-device", timeout=60)
        if self.shell("id -u") == "0":
            return "restarted adbd as root"
        # Production builds refuse `adb root`; rooted devices provide su instead (AOSP: `su 0 cmd`, Magisk: `su -c cmd`)
        for su in ("su -c", "su 0 sh -c"):
            self.su = su
            if self.shell("id -u", root=True) == "0":
                return f"using `{su}` ({(result.stdout + result.stderr).strip() or 'adb root failed'})"
        self.su = ""
        raise PrepareError(f"no root: adb root said '{(result.stdout + result.stderr).strip()}' and su is not available")

    def ensure_permissive(self) -> str:
        if self.shell("getenforce") != "Permissive":
            self.shell("setenforce 0", root=True)
        mode = self.shell("getenforce")
        return f"SELinux {mode}" if mode == "Permissive" else f"SELinux stays {mode} (frida may fail to inject)"

    def server_version(self, path: str) -> str:
        return self.shell(f"{shlex.quote(path)} --version 2>/dev/null", root=True)

    def ensure_installed(self, version: str) -> tuple[str, str]:
        """Returns the path of a frida-server of version on the device, pushing one if there is none."""
        default = f"{DEVICE_DIR}/frida-server-{version}"
        candidates = self.shell(f"ls {DEVICE_DIR}/frida-server* 2>/dev/null", root=True).split()
        for path in sorted(candidates, key=lambda p: p != default):
            if not path.endswith(".xz") and self.server_version(path) == version:
                return path, f"{path} installed"
        abi = self.shell("getprop ro.product.cpu.abi")
        if abi not in ABI_TO_ARCH:
            raise PrepareError(f"no frida-server build for ABI '{abi}'")
        local = download(version, ABI_TO_ARCH[abi])
        pushed = adb(self.serial, "push", str(local), default, timeout=120)
        if pushed.returncode != 0:
            raise PrepareError(f"adb push failed: {pushed.stderr.strip()}")
        self.shell(f"chmod 755 {default}", root=True)
        if self.server_version(default) != version:
            raise PrepareError(f"{default} doesn't run on this device")
        return default, f"installed {local.name} to {default}"

    def running_servers(self) -> dict[str, str]:
        """Maps the PID of each running frida-server to its version."""
        servers = {}
        for line in self.shell("ps -A -o PID,ARGS", root=True).splitlines()[1:]:
            pid, _, args = line.strip().partition(" ")
            if Path(args.split(" ")[0]).name.startswith("frida-server"):
                exe = self.shell(f"readlink /proc/{pid}/exe", root=True)
                servers[pid] = self.server_version(exe) if exe else "unknown"
        return servers

    def ensure_running(self, version: str, path: str) -> str:
        running = self.running_servers()
        stale = [pid for pid, v in running.items() if v != version]
        if stale:
            self.shell(f"kill {' '.join(stale)}", root=True)
        if any(v == version for v in running.values()):
            return f"frida-server {version} running" + (f", stopped {len(stale)} of other versions" if stale else "")
        self.shell(f"nohup {path} >/dev/null 2>&1 </dev/null &", root=True)
        deadline = time.monotonic() + START_TIMEOUT
        while time.monotonic() < deadline:
            if version in self.running_servers().values():
                return f"started {path}" + (f", stopped {len(stale)} of other versions" if stale else "")
            time.sleep(0.5)
        raise PrepareError(f"{path} didn't start within {START_TIMEOUT}s")

    def check_frida(self) -> str:
        access = frida.get_device(self.serial, timeout=5).query_system_parameters().get("access")
        if access != "full":
            raise PrepareError(f"frida reports access '{access}', expected 'full' (frida-server not reachable)")
        return "frida connects (access: full)"


def download(version: str, arch: str) -> Path:
    path = CACHE_DIR / f"frida-server-{version}-android-{arch}"
    if not path.exists():
        url = RELEASE_URL.format(version=version, arch=arch)
        print(f"    downloading {url}", flush=True)
        with urllib.request.urlopen(url, timeout=120) as response:
            data = lzma.decompress(response.read())
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)
    return path


def newest_compatible_version(host_version: str) -> str:
    """Returns the newest frida release with Android servers and the major version of host_version."""
    major = host_version.split(".")[0]
    try:
        with urllib.request.urlopen(RELEASES_API, timeout=30) as response:
            releases = json.load(response)
    except OSError as error:
        print(f"Can't list frida releases ({error}), using the host's version {host_version}")
        return host_version
    versions = [release["tag_name"] for release in releases if not release["prerelease"] and not release["draft"] and release["tag_name"].split(".")[0] == major and any(asset["name"].startswith(f"frida-server-{release['tag_name']}-android-") for asset in release["assets"])]
    return max(versions, key=lambda v: tuple(int(part) for part in v.split(".")), default=host_version)


def attached_serials() -> list[str]:
    lines = subprocess.run(["adb", "devices"], capture_output=True, text=True, timeout=ADB_TIMEOUT).stdout.splitlines()[1:]
    return [parts[0] for parts in (line.split() for line in lines) if len(parts) == 2 and parts[1] == "device"]


def prepare(serial: str, version: str) -> bool:
    print(f"===== {serial} =====", flush=True)
    device = Device(serial)
    try:
        print(f"  ok    {device.check_connection()}", flush=True)
        print(f"  ok    {device.ensure_root()}", flush=True)
        print(f"  ok    {device.ensure_permissive()}", flush=True)
        path, message = device.ensure_installed(version)
        print(f"  ok    {message}", flush=True)
        print(f"  ok    {device.ensure_running(version, path)}", flush=True)
        print(f"  ok    {device.check_frida()}", flush=True)
        return True
    except (PrepareError, subprocess.TimeoutExpired, frida.InvalidArgumentError, frida.TransportError, frida.ServerNotRunningError, OSError) as error:
        print(f"  FAIL  {error}", flush=True)
        return False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("-s", "--serial", action="append", help="Device to prepare (repeatable); default: all attached")
    parser.add_argument("--frida-version", help=f"frida-server version to install (default: the newest {frida.__version__.split('.')[0]}.x release, the host's frida being {frida.__version__})")
    args = parser.parse_args()

    serials = args.serial or attached_serials()
    if not serials:
        sys.exit("No Android device attached (adb devices)")

    version = args.frida_version or newest_compatible_version(frida.__version__)
    print(f"frida-server {version} (host frida {frida.__version__})")
    results = {serial: prepare(serial, version) for serial in serials}
    print("===== Summary =====")
    for serial, ok in results.items():
        print(f"{'ready ' if ok else 'FAILED'}  {serial}")
    sys.exit(0 if all(results.values()) else 1)


if __name__ == "__main__":
    main()
