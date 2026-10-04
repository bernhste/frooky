from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Optional

import frida
import frida_tools
import yaml

from .feed import Feed
from .messages import create_log_handler, create_user_script_message_handler

logger = logging.getLogger(__name__)

BRIDGES: dict[str, tuple[str, str]] = {
    "frida-java-bridge": ("java", "Java"),
    "frida-objc-bridge": ("objc", "ObjC"),
    "frida-swift-bridge": ("swift", "Swift"),
}


def compile_user_script(script_path: Path) -> str:
    """Compile a TypeScript user script using Frida's built-in compiler."""
    compiler = frida.Compiler()
    diagnostics: list[dict] = []
    compiler.on("diagnostics", lambda d: diagnostics.extend(d))
    try:
        return compiler.build(
            str(script_path.resolve()),
            bundle_format="iife",
            type_check="none",
            externals=list(BRIDGES.keys()),
        )
    except Exception as err:
        errors = "; ".join(d.get("text", "") for d in diagnostics if d.get("text"))
        raise ValueError(f"Failed to compile {script_path.name}: {errors or err}") from err


def prepare_user_script(source: str, platform: Optional[str] = None) -> str:
    """Preprocess user scripts (-l/--load) to resolve bridge imports, provide a require shim, and inject runtime bridges."""
    transformed = source
    bridges_to_inject = []
    bridges_dir = Path(frida_tools.__file__).parent / "bridges"

    for pkg, (bridge_stem, global_name) in BRIDGES.items():
        needed = (pkg in source) or bool(re.search(rf"\b{global_name}\b", source))
        if platform == "android" and global_name == "Java":
            needed = True

        def _sub_import(m: re.Match[str], gname: str = global_name) -> str:
            target = m.group(1).strip()
            if target.startswith("* as "):
                target = target[5:].strip()
            elif target.startswith("{") and target.endswith("}"):
                target = target[1:-1].strip()
            return f"var {target} = globalThis.{gname};"

        transformed = re.sub(
            rf"""import\s+((\* as\s+)?[\w$]+|\{{[\s\w$,]+\}})\s+from\s+['"]{pkg}['"][ \t]*;?""",
            _sub_import,
            transformed,
        )
        transformed = re.sub(
            rf"""import\s+['"]{pkg}['"][ \t]*;?""",
            f'/* import "{pkg}" */',
            transformed,
        )
        transformed = re.sub(
            rf"""(?:const|let|var)\s+([\w$]+)\s*=\s*require\(\s*['"]{pkg}['"]\s*\)[ \t]*;?""",
            rf"var \1 = globalThis.{global_name};",
            transformed,
        )

        if needed:
            bridge_file = bridges_dir / f"{bridge_stem}.js"
            if bridge_file.is_file():
                bridge_code = bridge_file.read_text(encoding="utf-8")
                header = (
                    f'if (typeof {global_name} === "undefined") {{\n'
                    f"(function() {{\n"
                    f"{bridge_code}\n"
                    f"bridge.default = bridge;\n"
                    f"bridge.{global_name} = bridge;\n"
                    f"globalThis.{global_name} = bridge;\n"
                    f"}})();\n"
                    f"}} else {{\n"
                    f"if (typeof {global_name}.default === 'undefined') {global_name}.default = {global_name};\n"
                    f"if (typeof {global_name}.{global_name} === 'undefined') {global_name}.{global_name} = {global_name};\n"
                    f"}}\n"
                )
                bridges_to_inject.append(header)

    shim = (
        "if (typeof require === 'undefined') {\n"
        "  globalThis.require = function(name) {\n"
        "    if (name === 'frida-java-bridge') return globalThis.Java;\n"
        "    if (name === 'frida-objc-bridge') return globalThis.ObjC;\n"
        "    if (name === 'frida-swift-bridge') return globalThis.Swift;\n"
        "    throw new Error('Cannot find module \"' + name + '\"');\n"
        "  };\n"
        "}\n"
    )

    return "".join(bridges_to_inject) + shim + transformed


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
    script_paths: list[Path],
    feed: Feed,
    runtime: Optional[str] = None,
    platform: Optional[str] = None,
) -> list[frida.core.Script]:
    """Load user-provided scripts (-l/--load) before the frooky agent runs."""
    scripts = []
    for script_path in script_paths:
        path = Path(script_path)
        if path.suffix == ".ts":
            source = compile_user_script(path)
        else:
            source = path.read_text(encoding="utf-8")
        prepared_source = prepare_user_script(source, platform=platform)
        script = session.create_script(prepared_source, runtime=runtime)
        script.on("message", create_user_script_message_handler(path.name, feed))
        script.set_log_handler(create_log_handler(feed, path.name))
        script.load()
        scripts.append(script)
    return scripts
