from __future__ import annotations

import sys
import threading
from typing import Callable, Optional


class KeyListener:
    """Reads single key presses from the terminal on a background thread.

    While running, the terminal is in cbreak mode (no line buffering, no echo); Ctrl+C still raises
    KeyboardInterrupt. Does nothing if stdin is not a terminal, e.g. when frooky runs in CI.
    """

    def __init__(self, on_key: Callable[[str], None]):
        self._on_key = on_key
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._restore_terminal: Optional[Callable[[], None]] = None

    @property
    def active(self) -> bool:
        return self._thread is not None

    def start(self) -> None:
        try:
            if not sys.stdin.isatty():
                return
        except (AttributeError, ValueError):
            return
        if sys.platform == "win32":
            target = self._read_windows
        else:
            import termios
            import tty

            fd = sys.stdin.fileno()
            old_attrs = termios.tcgetattr(fd)
            tty.setcbreak(fd)
            self._restore_terminal = lambda: termios.tcsetattr(fd, termios.TCSADRAIN, old_attrs)
            target = self._read_posix
        self._thread = threading.Thread(target=target, name="frooky-keys", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1)
            self._thread = None
        if self._restore_terminal is not None:
            self._restore_terminal()
            self._restore_terminal = None

    def _read_posix(self) -> None:
        import os
        import select

        fd = sys.stdin.fileno()
        while not self._stop.is_set():
            readable, _, _ = select.select([fd], [], [], 0.2)
            if readable:
                data = os.read(fd, 32)
                if not data:
                    return
                for key in data.decode(errors="ignore"):
                    self._on_key(key)

    def _read_windows(self) -> None:
        import msvcrt

        while not self._stop.is_set():
            if msvcrt.kbhit():
                self._on_key(msvcrt.getwch())
            else:
                self._stop.wait(0.1)
