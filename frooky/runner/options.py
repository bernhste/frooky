from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class RunnerOptions:
    """Options for the FrookyRunner."""

    hook_paths: list[Path]
    output_path: Path
    device_id: Optional[str] = None
    use_usb: bool = False
    remote: bool = False
    host: Optional[str] = None
    certificate: Optional[str] = None
    attach_frontmost: bool = False
    attach_name: Optional[str] = None
    attach_identifier: Optional[str] = None
    attach_pid: Optional[int] = None
    spawn: Optional[str] = None
    user_scripts: list[Path] = field(default_factory=list)
    agent_option_verbose: bool = False
    agent_option_very_verbose: bool = False
    agent_option_resolver_timeout: Optional[int] = None
    print_events: bool = False
