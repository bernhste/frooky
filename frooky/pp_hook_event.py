from __future__ import annotations

import pprint as _pprint
import re as _re
from datetime import datetime as _datetime

_DEFAULT_WIDTH = 120
_MIN_WIDTH = 60
_GUTTER = "│ "
_WRAP_INDENT = "    "
_ITEM_PREFIX = "    "
_VALUE_INDENT = "      "
_LABEL_ARGS_IN = "arguments in:"
_LABEL_ARGS_OUT = "arguments out:"
_LABEL_RET = "returns:"
_LABEL_STACK = "stack trace"
# Where the values of the one-line fields start: the longest key, "stack trace:", plus two spaces.
_KEY_WIDTH = 14

# Values use the terminal's default foreground; every other color is a mid-tone from the fixed
# 256-color palette with a contrast of at least 3:1 on both dark and light terminal backgrounds.
_C_RESET = "\033[0m"
_C_BORDER = "\033[38;5;31m"
_C_KEY = "\033[38;5;244m"
_C_VAL = "\033[39m"
_C_TYPE_J = "\033[38;5;133m"
_C_TYPE_N = "\033[38;5;64m"
_C_RET_TYPE = "\033[38;5;244m"

# Muted foregrounds, one per parameter in signature order, so each argument row can be matched to
# its parameter in the `function:` line at a glance. Cycles for long parameter lists.
_PARAM_COLORS = [f"\033[38;5;{n}m" for n in (67, 137, 97, 65, 131, 66, 101, 103)]

# A run of text and the color it is printed in.
_Span = tuple[str, str]

# Integer types whose values the agent sends as decimal strings because a JS number can't hold
# 64 bits exactly: the native aliases of int64/uint64/long/ulong/size_t/ssize_t in
# nativeFridaType.ts, plus Java's long (PrimitiveDecoder.ts). Printed without quotes.
_INTEGER_STRING_TYPES = {
    "int64", "int64_t", "long long", "signed long long", "long long int", "llong",
    "uint64", "uint64_t", "unsigned long long", "unsigned long long int", "ullong",
    "long", "signed long", "long int", "intptr_t", "ptrdiff_t", "off_t", "time_t",
    "ulong", "unsigned long", "unsigned long int", "uintptr_t",
    "size_t", "ssize_t",
}  # fmt: skip
_INTEGER_STRING = _re.compile(r"-?\d+")

# A decoder's output is an envelope of exactly these keys (see DecodedValue in the TS agent);
# "name" is optional. Anything matching this shape gets unwrapped down to its leaf value below.
_DECODED_VALUE_KEYS = {"type", "value", "name"}


def _top_border(label: str, color: str, width: int) -> str:
    tag = f" {label} "
    dashes = "─" * max(width - len(tag) - 3, 0)
    return f"{_C_BORDER}┌─{color}{tag}{_C_BORDER}{dashes}┐{_C_RESET}"


def _bot_border(width: int) -> str:
    return f"{_C_BORDER}└{'─' * (width - 2)}┘{_C_RESET}"


class _Lines:
    """Collects the lines of one event box behind a left border, wrapping long text to the box width."""

    def __init__(self, width: int):
        self.width = width
        self.text_max = width - len(_GUTTER) - 1
        self.lines: list[str] = []

    def add(self, text: str = "") -> None:
        self.lines.append(f"{_C_BORDER}{_GUTTER.rstrip() if not text else _GUTTER}{_C_RESET}{text}")

    def add_wrapped(self, text: str | list[_Span], continuation_indent: str, head: str = "", colored_head: str | None = None) -> None:
        """Add `head` + `text`, hard-wrapping `text` so no line exceeds the box.

        `text` is printed in the value color, or given as colored spans. `head` is a short prefix
        that never wraps, e.g. an argument's name and type columns; it is printed as `colored_head`
        if given. Continuation lines start with `continuation_indent`.
        """
        spans = [(text, _C_VAL)] if isinstance(text, str) else text
        length = sum(len(t) for t, _ in spans)
        first = max(self.text_max - len(head), 1)
        rest = max(self.text_max - len(continuation_indent), 1)
        colored_head = head if colored_head is None else colored_head
        self.add(f"{colored_head}{_render_spans(spans, 0, first)}" if length else colored_head.rstrip())
        for start in range(first, length, rest):
            self.add(f"{continuation_indent}{_render_spans(spans, start, start + rest)}")


def _render_spans(spans: list[_Span], start: int, end: int) -> str:
    """Render the visible characters `start` to `end` of `spans`, each run in its own color."""
    out = []
    pos = 0
    for text, color in spans:
        piece = text[max(start - pos, 0) : max(end - pos, 0)]
        if piece:
            out.append(f"{color}{piece}{_C_RESET}")
        pos += len(text)
    return "".join(out)


def _is_decoded_value(v) -> bool:
    return isinstance(v, dict) and "value" in v and set(v.keys()) <= _DECODED_VALUE_KEYS


def _unwrap(v):
    """Recursively strip {type, value, name} decoder envelopes down to their leaf values.

    A decoded object's fields (e.g. an Intent's `flags`, `extras`, ...) are themselves decoder
    envelopes even though the object holding them isn't one, so plain dicts are walked field by
    field rather than only unwrapping at the top level. A list whose entries all carry a distinct
    "name" (e.g. a decoded Bundle's key/value pairs) becomes a dict keyed by name instead of a bare
    list, so the value stays associated with the name it came from; a list of unnamed entries (e.g.
    a decoded Set<String>'s elements) stays a plain list.
    """
    if _is_decoded_value(v):
        return _unwrap(v["value"])

    if isinstance(v, dict):
        return {k: _unwrap(val) for k, val in v.items()}

    if isinstance(v, list):
        names = [item.get("name") for item in v if isinstance(item, dict)]
        if len(names) == len(v) and all(names) and len(set(names)) == len(names):
            return {item["name"]: _unwrap(item.get("value")) for item in v}
        return [_unwrap(item) for item in v]

    return v


def _format_param(a: dict) -> str:
    return f"{a.get('type', '?')} {a['name']}" if a.get("name") else a.get("type", "?")


def _format_signature(name: str, args: list) -> str:
    return f"{name}({', '.join(_format_param(a) for a in args)})"


def _signature_spans(name: str, args: list, colors: list[str]) -> list[_Span]:
    """The signature as spans, each parameter in the color of its argument rows."""
    spans: list[_Span] = [(f"{name}(", _C_VAL)]
    for i, (a, color) in enumerate(zip(args, colors)):
        if i:
            spans.append((", ", _C_VAL))
        spans.append((_format_param(a), color))
    spans.append((")", _C_VAL))
    return spans


def _param_colors(args_in: list, args_out: list) -> tuple[list[str], list[str]]:
    """Colors for the rows of `args_in` and `args_out`, by signature position.

    An `inout` parameter appears in both lists; its out row reuses the in row's color when it has
    a name to match on. Other out rows get the next colors after the signature's.
    """
    colors_in = [_PARAM_COLORS[i % len(_PARAM_COLORS)] for i in range(len(args_in))]
    by_name = {a["name"]: c for a, c in zip(args_in, colors_in) if a.get("name")}
    colors_out = []
    next_color = len(args_in)
    for a in args_out:
        if a.get("name") in by_name:
            colors_out.append(by_name[a["name"]])
        else:
            colors_out.append(_PARAM_COLORS[next_color % len(_PARAM_COLORS)])
            next_color += 1
    return colors_in, colors_out


def _is_integer_string(t: str, v) -> bool:
    words = [w for w in t.lower().split() if w not in ("const", "volatile")]
    return isinstance(v, str) and " ".join(words) in _INTEGER_STRING_TYPES and bool(_INTEGER_STRING.fullmatch(v))


def _value_lines(v, width: int) -> list[str]:
    # pformat splits a long string into a parenthesized ('...' '...') concatenation, breaking at
    # whitespace and line endings, so strings stay a single repr and add_wrapped hard-wraps them.
    if isinstance(v, str):
        return [repr(v)]
    return _pprint.pformat(v, width=max(width, 20), compact=True).splitlines()


def _add_item(out: _Lines, color: str, t: str, name: str | None, v) -> None:
    """Add one `- <type> <name>` entry with its value below it, so values always start at the same column."""
    head = f"{t} {name}" if name else t
    out.add_wrapped([(head, color)], _ITEM_PREFIX + _WRAP_INDENT, _ITEM_PREFIX, f"{_C_KEY}{_ITEM_PREFIX}")
    if v is None:
        return
    values = [v] if _is_integer_string(t, v) else _value_lines(v, out.text_max - len(_VALUE_INDENT))
    for line in values:
        out.add_wrapped(line, _VALUE_INDENT + _WRAP_INDENT, _VALUE_INDENT)


def _add_arguments(out: _Lines, label: str, args: list, colors: list[str]) -> None:
    out.add()
    out.add(f"{_C_KEY}{label}{_C_RESET}")
    for a, color in zip(args, colors):
        _add_item(out, color, a.get("type", "?"), a.get("name"), _unwrap(a.get("value")))


def _add_return(out: _Lines, return_val: dict) -> None:
    t = return_val.get("type", "?")
    v = _unwrap(return_val.get("value")) if t != "void" else None
    out.add()
    out.add(f"{_C_KEY}{_LABEL_RET}{_C_RESET}")
    _add_item(out, _C_RET_TYPE, t, None, v)


def _add_field(out: _Lines, key: str, value: str | list[_Span]) -> None:
    head = f"{key + ':':<{_KEY_WIDTH}}"
    out.add_wrapped(value, " " * len(head) + _WRAP_INDENT, head, f"{_C_KEY}{head}")


def _add_stack_section(out: _Lines, label: str, frames: list) -> None:
    out.add()
    key = label + ":"
    head = f"{key:<{_KEY_WIDTH}}" if len(key) < _KEY_WIDTH else f"{key} "
    for i, frame in enumerate(frames):
        prefix = head if i == 0 else " " * len(head)
        out.add_wrapped(frame, " " * len(head) + _WRAP_INDENT, prefix, f"{_C_KEY}{prefix}")


def _add_stack(out: _Lines, stack_trace: list | dict) -> None:
    if isinstance(stack_trace, dict):
        platform_stack = stack_trace.get("platformStackTrace") or []
        native_stack = stack_trace.get("nativeStackTrace") or []
        if platform_stack and native_stack:
            _add_stack_section(out, "platform stack", platform_stack)
            _add_stack_section(out, "native stack", native_stack)
        elif platform_stack:
            _add_stack_section(out, _LABEL_STACK, platform_stack)
        elif native_stack:
            _add_stack_section(out, "native stack", native_stack)
    elif isinstance(stack_trace, list) and stack_trace:
        _add_stack_section(out, _LABEL_STACK, stack_trace)


def _local_time(timestamp: object) -> object:
    """The agent's UTC ISO timestamp in the host's local time, e.g. `2026-09-27 09:49:16.405`; anything else as is."""
    if not isinstance(timestamp, str):
        return timestamp
    try:
        # fromisoformat only accepts a trailing "Z" from Python 3.11 on
        parsed = _datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        return timestamp
    if parsed.tzinfo is None:
        return timestamp
    return parsed.astimezone().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def _format_hook(out: _Lines, hook: dict, id_key: str, id_label: str, fn_key: str, fn_label: str) -> None:
    """Shared formatter for Java and native hook events."""
    args_in = hook.get("argsIn") or []
    args_out = hook.get("argsOut") or []
    return_val = hook.get("returnValue")
    stack = hook.get("stackTrace") or []

    _add_field(out, "time", _local_time(hook.get("timestamp", "?")))
    _add_field(out, id_label, hook.get(id_key, "?"))
    colors_in, colors_out = _param_colors(args_in, args_out)
    _add_field(out, fn_label, _signature_spans(hook.get(fn_key, "?"), args_in, colors_in))

    if args_in:
        _add_arguments(out, _LABEL_ARGS_IN, args_in, colors_in)
    if args_out:
        _add_arguments(out, _LABEL_ARGS_OUT, args_out, colors_out)
    if return_val:
        _add_return(out, return_val)
    if stack:
        _add_stack(out, stack)


def format_hook_event(hook: dict, width: int = _DEFAULT_WIDTH) -> list[str]:
    """Format a NativeHookEvent or JavaHookEvent dict as the lines of a box `width` columns wide, with ANSI colors."""
    out = _Lines(max(width, _MIN_WIDTH))
    if "java" in hook.get("type", ""):
        field_type = hook.get("fieldType", {})
        ft_str = field_type.get("fieldType", str(field_type)) if isinstance(field_type, dict) else str(field_type)
        label, color = f"java ({ft_str})", _C_TYPE_J
        _format_hook(out, hook, "javaClassName", "class", "method", "method")
    else:
        label, color = "native", _C_TYPE_N
        # hooks declared by `offset` instead of `symbol` carry the offset in its place
        fn_key = "symbol" if "symbol" in hook else "offset"
        _format_hook(out, hook, "module", "module", fn_key, "function")
    return [_top_border(label, color, out.width), *out.lines, _bot_border(out.width)]


def pp_hook_event(hook: dict, width: int = _DEFAULT_WIDTH) -> None:
    """Pretty-print a NativeHookEvent or JavaHookEvent dict to stdout."""
    print("\n".join(format_hook_event(hook, width)))
