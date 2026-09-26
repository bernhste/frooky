from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

import yaml

from .config import load_hook_config

# (mtime, size, inode): an atomic save (write temp file + rename) changes the inode even when
# mtime and size happen to match
_FileStat = tuple[int, int, int]


def _stat(path: Path) -> Optional[_FileStat]:
    try:
        st = os.stat(path)
    except OSError:
        return None
    return st.st_mtime_ns, st.st_size, st.st_ino


def _print_error(path: Path, error: Exception) -> None:
    print(f"Hook file {path} not reloaded, keeping the previous version: {error}", file=sys.stderr)


@dataclass
class _WatchedFile:
    path: Path
    stat: Optional[_FileStat]
    config: Any


class HookFileWatcher:
    """Polls hook files for changes.

    A file is only reported when its parsed content changed, so saving without changes or editing
    comments and formatting does not trigger a reload. A file that fails to parse is reported via
    ``on_error`` and retried on its next modification; the previous version stays in effect.
    """

    def __init__(self, hook_paths: list[Path], on_error: Callable[[Path, Exception], None] = _print_error):
        self._on_error = on_error
        self._files: dict[Path, _WatchedFile] = {}
        # take the stat before reading, so a change made while loading is picked up by the next poll
        for path in hook_paths:
            if path not in self._files:
                stat = _stat(path)
                self._files[path] = _WatchedFile(path, stat, load_hook_config(path))
        self.configs: list[Any] = [self._files[path].config for path in hook_paths]

    def poll(self) -> list[tuple[Path, Any]]:
        """Return ``(path, config)`` for every hook file whose parsed content changed since the last poll."""
        changed = []
        for watched in self._files.values():
            stat = _stat(watched.path)
            # a missing file is usually an editor's atomic save in progress; check again next poll
            if stat is None or stat == watched.stat:
                continue
            watched.stat = stat
            try:
                config = load_hook_config(watched.path)
            except (OSError, UnicodeDecodeError, yaml.YAMLError, json.JSONDecodeError) as e:
                self._on_error(watched.path, e)
                continue
            if config == watched.config:
                continue
            watched.config = config
            changed.append((watched.path, config))
        return changed
