from __future__ import annotations

import threading
from typing import Optional

import frida

from .options import RunnerOptions

SUPPORTED_PLATFORMS = ("android", "ios")


def get_device(options: RunnerOptions) -> frida.core.Device:
    """Get the Frida device based on options."""
    if options.device_id:
        return frida.get_device(options.device_id, timeout=5)
    elif options.host:
        return frida.get_device_manager().add_remote_device(options.host, certificate=options.certificate)
    elif options.remote:
        return frida.get_remote_device()
    elif options.use_usb:
        return frida.get_usb_device(timeout=5)
    else:
        return frida.get_local_device()


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
        for proc in device.enumerate_processes():
            if proc.identifier == options.attach_identifier:
                return device.attach(proc.pid), None
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
