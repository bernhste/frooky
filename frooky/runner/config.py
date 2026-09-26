from __future__ import annotations

import json
import logging
from pathlib import Path

import frida
import yaml

from .messages import create_user_script_message_handler

logger = logging.getLogger(__name__)


def load_hook_config(hook_path: Path) -> dict:
    """Load a single hook YAML (or deprecated JSON) file."""
    with open(hook_path, "r", encoding="utf-8") as f:
        if Path(hook_path).suffix in (".yaml", ".yml"):
            return yaml.safe_load(f)
        logger.warning("%s is in JSON format, which is deprecated. Please migrate to YAML.", Path(hook_path).name)
        return json.load(f)


def load_hook_configs(hook_paths: list[Path]) -> list[dict]:
    """Load hook YAML (or deprecated JSON) files and return them as a list of hook configs."""
    return [load_hook_config(hook_path) for hook_path in hook_paths]


def load_user_scripts(session: frida.core.Session, script_paths: list[Path]) -> list[frida.core.Script]:
    """Load user-provided scripts (-l/--load) before the frooky agent runs."""
    scripts = []
    for script_path in script_paths:
        source = Path(script_path).read_text(encoding="utf-8")
        script = session.create_script(source)
        script.on("message", create_user_script_message_handler(script_path.name))
        script.load()
        scripts.append(script)
    return scripts
