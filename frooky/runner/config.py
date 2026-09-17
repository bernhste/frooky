from __future__ import annotations

import json
import logging
from pathlib import Path

import frida
import yaml

from .messages import create_user_script_message_handler

logger = logging.getLogger(__name__)


def load_hook_configs(hook_paths: list[Path]) -> list[dict]:
    """Load hook YAML (or deprecated JSON) files and return them as a list of hook configs."""
    hook_configs = []

    for hook_path in hook_paths:
        with open(hook_path, "r", encoding="utf-8") as f:
            if Path(hook_path).suffix in (".yaml", ".yml"):
                hook_data = yaml.safe_load(f)
            else:
                logger.warning("%s is in JSON format, which is deprecated. Please migrate to YAML.", Path(hook_path).name)
                hook_data = json.load(f)

            hook_configs.append(hook_data)

    return hook_configs


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
