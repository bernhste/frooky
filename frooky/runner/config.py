from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Optional

import frida
import yaml

from .feed import Feed
from .messages import create_log_handler, create_user_script_message_handler

logger = logging.getLogger(__name__)

# left as require() calls, which frooky resolves, see load_user_scripts()
BRIDGE_MODULES = ["frida-java-bridge", "frida-objc-bridge", "frida-swift-bridge"]


def compile_user_script(script_path: Path) -> str:
    """Compile a JavaScript or TypeScript user script (-l/--load) using Frida's built-in compiler, into an IIFE."""
    compiler = frida.Compiler()
    diagnostics: list[dict] = []
    compiler.on("diagnostics", lambda d: diagnostics.extend(d))
    try:
        return compiler.build(
            str(script_path.resolve()),
            bundle_format="iife",
            type_check="none",
            externals=BRIDGE_MODULES,
        )
    except Exception as err:
        errors = "; ".join(d.get("text", "") for d in diagnostics if d.get("text"))
        raise ValueError(f"Failed to compile {script_path.name}: {errors or err}") from err


def uses_java_bridge(source: str) -> bool:
    """Whether a compiled user script imports frida-java-bridge or uses the global `Java`."""
    return '"frida-java-bridge"' in source or re.search(r"\bJava\b", source) is not None


def load_hook_config(hook_path: Path) -> dict:
    """Load a single hook YAML (or deprecated JSON) file."""
    with open(hook_path, "r", encoding="utf-8") as f:
        if Path(hook_path).suffix in (".yaml", ".yml"):
            loader = getattr(yaml, "CSafeLoader", yaml.SafeLoader)
            return yaml.load(f, Loader=loader)
        logger.warning("%s is in JSON format, which is deprecated. Please migrate to YAML.", Path(hook_path).name)
        return json.load(f)


def load_hook_configs(hook_paths: list[Path]) -> list[dict]:
    """Load hook YAML (or deprecated JSON) files and return them as a list of hook configs."""
    return [load_hook_config(hook_path) for hook_path in hook_paths]


def load_user_scripts(
    session: frida.core.Session,
    agent: frida.core.Script,
    script_paths: list[Path],
    feed: Feed,
    runtime: Optional[str] = None,
) -> list[frida.core.Script]:
    """Load the user scripts (-l/--load) in order, before the frooky agent is initialized. A script that uses
    frida-java-bridge runs in the agent's script and shares its bridge: two bridges in one process recurse into each
    other's replacement of a method, which Java.perform() makes in a spawned app. Any other script is loaded as its own
    script, which is returned."""
    scripts = []
    for path in script_paths:
        source = compile_user_script(path)
        try:
            if uses_java_bridge(source):
                agent.exports_sync.load_user_script(path.name, source)
                continue
            script = session.create_script(source, runtime=runtime)
            script.on("message", create_user_script_message_handler(path.name, feed))
            script.set_log_handler(create_log_handler(feed, path.name))
            script.load()
        except Exception as err:
            raise RuntimeError(f"Failed to load {path.name}: {err}") from err
        scripts.append(script)
    return scripts
