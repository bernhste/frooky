from __future__ import annotations

import sys
import threading
from typing import Callable, Optional

import frida

from .options import RunnerOptions

SUPPORTED_PLATFORMS = ("android", "ios", "debian")


def get_device(options: RunnerOptions, choose: Callable[[list[frida.core.Device]], frida.core.Device] | None = None) -> frida.core.Device:
    """Get the Frida device based on options. `choose` picks one of several USB devices (default: `choose_device`)."""
    if options.device_id:
        return frida.get_device(options.device_id, timeout=5)
    elif options.host:
        return frida.get_device_manager().add_remote_device(options.host, certificate=options.certificate)
    elif options.remote:
        return frida.get_remote_device()
    elif options.use_usb:
        return get_usb_device(choose or choose_device)
    else:
        return frida.get_local_device()


def get_usb_device(choose: Callable[[list[frida.core.Device]], frida.core.Device]) -> frida.core.Device:
    """Get the only USB device, or let the user choose one when several are attached."""
    # waits for the first device, so the enumeration below doesn't miss devices that are still being discovered
    first = frida.get_usb_device(timeout=5)
    devices = sorted((device for device in frida.enumerate_devices() if device.type == "usb"), key=lambda device: device.id)
    if len(devices) <= 1:
        return first
    return choose(devices)


def describe_device(device: frida.core.Device) -> str:
    """e.g. `Android 15, API 35 (emulator-5554)`, or the device name if its OS can't be queried"""
    try:
        params = device.query_system_parameters()
    except Exception:
        params = {}
    os_info = params.get("os", {})
    parts = [f"{os_info['name']} {os_info.get('version', '')}".rstrip()] if os_info.get("name") else [device.name]
    if params.get("api-level") is not None:
        parts.append(f"API {params['api-level']}")
    return f"{', '.join(parts)} ({device.id})"


def choose_device(devices: list[frida.core.Device], prompt: Callable[[str], str] = input) -> frida.core.Device:
    """Ask the user which of several devices to use."""
    listing = "\n".join(f"  {index}) {describe_device(device)}" for index, device in enumerate(devices, start=1))
    if not sys.stdin.isatty():
        raise RuntimeError(f"Several USB devices are attached, choose one with -s/-D <ID>:\n{listing}")

    print(f"Several USB devices are attached:\n{listing}", file=sys.stderr)
    while True:
        try:
            answer = prompt(f"Choose a device [1-{len(devices)}]: ").strip()
        except EOFError:
            raise RuntimeError("No device chosen") from None
        if answer.isdigit() and 1 <= int(answer) <= len(devices):
            return devices[int(answer) - 1]
        # the device ID works too, e.g. `emulator-5554`
        for device in devices:
            if answer == device.id:
                return device


def detect_platform(device: frida.core.Device) -> str:
    """Detect the target platform (android/ios) from the connected device."""
    params = device.query_system_parameters()
    os_id = params.get("os", {}).get("id")

    if os_id not in SUPPORTED_PLATFORMS:
        raise RuntimeError(f"Unsupported target platform '{os_id}'. Frooky only supports: {', '.join(SUPPORTED_PLATFORMS)}.")

    return os_id


def attach_or_spawn(device: frida.core.Device, options: RunnerOptions) -> tuple[frida.core.Session, Optional[int]]:
    """Attach to or spawn the target process. Returns the session and, if spawned, its PID."""
    if options.attach_frontmost:
        app = device.get_frontmost_application()
        if app is None:
            raise RuntimeError("No frontmost application found")
        return device.attach(app.pid), None

    elif options.attach_name:
        return device.attach(options.attach_name), None

    elif options.attach_identifier:
        try:
            for app in device.enumerate_applications():
                if app.identifier == options.attach_identifier and app.pid != 0:
                    return device.attach(app.pid), None
        except Exception:
            pass
        return device.attach(options.attach_identifier), None

    elif options.attach_pid:
        return device.attach(options.attach_pid), None

    elif options.spawn:
        pid = device.spawn(options.spawn)
        session = device.attach(pid)
        return session, pid

    else:
        raise RuntimeError("No target specified")


def get_device_frida_version(session: frida.core.Session, timeout: float = 5.0) -> str:
    """Inject a throwaway probe script to read Frida's version on the device.

    Runs before the frooky agent and any user scripts, so a hang/crash of either
    can't be blamed on the probe, and so the version is available for the header.
    """
    result: dict[str, str] = {}
    received = threading.Event()

    def on_message(message, data):
        if message.get("type") == "send":
            result["version"] = str(message.get("payload"))
        received.set()

    probe_script = session.create_script("send(Frida.version);")
    probe_script.on("message", on_message)
    try:
        probe_script.load()
        received.wait(timeout)
    finally:
        probe_script.unload()

    return result.get("version", "unknown")


def describe_target(device: frida.core.Device, options: RunnerOptions) -> str:
    """Get a human-readable description of the target for the header."""
    if options.attach_frontmost:
        app = device.get_frontmost_application()
        if app:
            return f"frontmost application: {app.name} (PID: {app.pid})"
        return "frontmost application"
    elif options.attach_name:
        return options.attach_name
    elif options.attach_identifier:
        return options.attach_identifier
    elif options.attach_pid:
        return str(options.attach_pid)
    elif options.spawn:
        return f"{options.spawn} (spawned)"
    return "unknown target"
