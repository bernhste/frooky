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


_YAML_TAG = "tag:yaml.org,2002:"
# The scalars of the YAML 1.2 core schema, which the JSON schema of hook files and its validators read hook files by
_YAML_SCALARS = {
    "bool": (r"true|True|TRUE|false|False|FALSE", "tTfF"),
    "int": (r"[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+", "-+0123456789"),
    "float": (r"[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN)", "-+0123456789."),
}


def _construct_int(loader: yaml.Loader, node: yaml.ScalarNode) -> int:
    value = loader.construct_scalar(node)
    if value.startswith("0x"):
        return int(value, 16)
    if value.startswith("0o"):
        return int(value[2:], 8)
    # `012` is 12: YAML 1.2 has no octal numbers with a leading zero
    return int(value, 10)


def _hook_file_loader() -> type:
    """A safe YAML loader that reads booleans and numbers as YAML 1.2 does, like the JSON schema of hook files and
    the editors that use it. PyYAML reads YAML 1.1, in which `yes`, `no`, `on` and `off` are booleans, `012` is the
    octal number 10, `1:30` the number 90 and `2026-01-01` a date. In hook files these are names and numbers, e.g.
    the parameter `off` in `offset: off`, a method `on` of an obfuscated app or the offset `0001a2b4`."""
    base = getattr(yaml, "CSafeLoader", yaml.SafeLoader)
    replaced = {_YAML_TAG + name for name in (*_YAML_SCALARS, "timestamp")}

    class HookFileLoader(base):
        pass

    HookFileLoader.yaml_implicit_resolvers = {first: [(tag, pattern) for tag, pattern in resolvers if tag not in replaced] for first, resolvers in base.yaml_implicit_resolvers.items()}
    # in this order: every int also matches the pattern of a float
    for name, (pattern, first) in _YAML_SCALARS.items():
        HookFileLoader.add_implicit_resolver(_YAML_TAG + name, re.compile(f"^(?:{pattern})$"), list(first))
    HookFileLoader.add_constructor(_YAML_TAG + "int", _construct_int)
    return HookFileLoader


_HOOK_FILE_LOADER = _hook_file_loader()


def load_hook_config(hook_path: Path) -> dict:
    """Load a single hook YAML (or deprecated JSON) file."""
    with open(hook_path, "r", encoding="utf-8") as f:
        if Path(hook_path).suffix in (".yaml", ".yml"):
            return yaml.load(f, Loader=_HOOK_FILE_LOADER)
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
