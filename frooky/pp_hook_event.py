from __future__ import annotations

import pprint as _pprint
import re as _re

_DEFAULT_WIDTH = 120
_MIN_WIDTH = 60
_GUTTER = "│ "
_WRAP_INDENT = "    "
_SECTION_INDENT = "  "
_COLUMN_GAP = "  "
_LABEL_ARGS_IN = "arguments in"
_LABEL_ARGS_OUT = "arguments out"
_LABEL_RET = "returns"
_LABEL_STACK = "stack"
_KEY_WIDTH = 10

_C_RESET = "\033[0m"
_C_BORDER = "\033[36m"
_C_KEY = "\033[37m"
_C_VAL = "\033[97m"
_C_DIM = "\033[2m"
_C_TYPE_J = "\033[35m"
_C_TYPE_N = "\033[32m"

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

    def add_wrapped(self, text: str, continuation_indent: str, head: str = "", colored_head: str | None = None) -> None:
        """Add `head` + `text`, hard-wrapping `text` so no line exceeds the box.

        `head` is a short prefix that never wraps, e.g. an argument's name and type columns; it is
        printed as `colored_head` if given. Continuation lines start with `continuation_indent`.
        """
        first = max(self.text_max - len(head), 1)
        rest = max(self.text_max - len(continuation_indent), 1)
        colored_head = head if colored_head is None else colored_head
        self.add(f"{colored_head}{_C_VAL}{text[:first]}{_C_RESET}" if text else colored_head.rstrip())
        remainder = text[first:]
        while remainder:
            self.add(f"{continuation_indent}{_C_VAL}{remainder[:rest]}{_C_RESET}")
            remainder = remainder[rest:]


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


def _format_signature(name: str, args: list) -> str:
    if not args:
        return f"{name}()"
    params = ", ".join(f"{a.get('type', '?')} {a['name']}" if a.get("name") else a.get("type", "?") for a in args)
    return f"{name}({params})"


def _is_integer_string(t: str, v) -> bool:
    words = [w for w in t.lower().split() if w not in ("const", "volatile")]
    return isinstance(v, str) and " ".join(words) in _INTEGER_STRING_TYPES and bool(_INTEGER_STRING.fullmatch(v))


def _value_lines(v, width: int) -> list[str]:
    # pformat splits a long string into a parenthesized ('...' '...') concatenation, breaking at
    # whitespace and line endings, so strings stay a single repr and add_wrapped hard-wraps them.
    if isinstance(v, str):
        return [repr(v)]
    return _pprint.pformat(v, width=max(width, 20), compact=True).splitlines()


class _Columns:
    """Where the type and value columns of the argument and return rows start, shared by all
    sections of an event so they line up. Values move below their row if the columns get too wide."""

    def __init__(self, out: _Lines, args: list, return_val: dict | None):
        names = [a.get("name") or "" for a in args]
        types = [a.get("type", "?") for a in args] + ([return_val.get("type", "?")] if return_val else [])
        name_end = max([len(_SECTION_INDENT + n) for n in names] + [len(_LABEL_RET)])
        self.type_col = name_end + len(_COLUMN_GAP)
        self.value_col = self.type_col + max(len(t) for t in types) + len(_COLUMN_GAP) if types else self.type_col
        self.value_below = self.value_col > out.text_max // 2
        if self.value_below:
            self.value_col = len(_SECTION_INDENT) * 2


def _add_row(out: _Lines, cols: _Columns, name: str, name_color: str, t: str, v) -> None:
    head = f"{name:<{cols.type_col}}{t}"
    colored = f"{name_color}{name:<{cols.type_col}}{_C_DIM}{t}{_C_RESET}"
    indent = " " * cols.value_col
    if _is_integer_string(t, v):
        values = [v]
    else:
        values = _value_lines(v, out.text_max - cols.value_col) if v is not None else []
    if len(head) > out.text_max:
        out.add_wrapped(head, _SECTION_INDENT + _WRAP_INDENT)
    elif not values or cols.value_below:
        out.add_wrapped("", indent, head, colored)
    else:
        pad = " " * (cols.value_col - len(head))
        out.add_wrapped(values.pop(0), indent + _WRAP_INDENT, head + pad, colored + pad)
    for line in values:
        out.add_wrapped(line, indent + _WRAP_INDENT, indent)


def _add_arguments(out: _Lines, cols: _Columns, label: str, args: list) -> None:
    out.add()
    out.add(f"{_C_KEY}{label}{_C_RESET}")
    for a in args:
        _add_row(out, cols, _SECTION_INDENT + (a.get("name") or ""), _C_VAL, a.get("type", "?"), _unwrap(a.get("value")))


def _add_return(out: _Lines, cols: _Columns, return_val: dict) -> None:
    t = return_val.get("type", "?")
    v = _unwrap(return_val.get("value")) if t != "void" else None
    out.add()
    _add_row(out, cols, _LABEL_RET, _C_KEY, t, v)


def _add_field(out: _Lines, key: str, value: str) -> None:
    head = f"{key:<{_KEY_WIDTH}}:  "
    out.add_wrapped(value, " " * len(head) + _WRAP_INDENT, head, f"{_C_KEY}{head}")


def _add_stack(out: _Lines, stack_trace: list) -> None:
    out.add()
    head = f"{_LABEL_STACK:<{_KEY_WIDTH}}:  "
    for i, frame in enumerate(stack_trace):
        prefix = head if i == 0 else " " * len(head)
        out.add_wrapped(frame, " " * len(head) + _WRAP_INDENT, prefix, f"{_C_KEY}{prefix}")


def _format_hook(out: _Lines, hook: dict, id_key: str, id_label: str, fn_key: str, fn_label: str) -> None:
    """Shared formatter for Java and native hook events."""
    args_in = hook.get("argsIn") or []
    args_out = hook.get("argsOut") or []
    return_val = hook.get("returnValue")
    stack = hook.get("stackTrace") or []

    _add_field(out, "time", hook.get("timestamp", "?"))
    _add_field(out, id_label, hook.get(id_key, "?"))
    _add_field(out, fn_label, _format_signature(hook.get(fn_key, "?"), args_in))

    cols = _Columns(out, args_in + args_out, return_val)
    if args_in:
        _add_arguments(out, cols, _LABEL_ARGS_IN, args_in)
    if args_out:
        _add_arguments(out, cols, _LABEL_ARGS_OUT, args_out)
    if return_val:
        _add_return(out, cols, return_val)
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
        _format_hook(out, hook, "module", "module", "symbol", "function")
    return [_top_border(label, color, out.width), *out.lines, _bot_border(out.width)]


def pp_hook_event(hook: dict, width: int = _DEFAULT_WIDTH) -> None:
    """Pretty-print a NativeHookEvent or JavaHookEvent dict to stdout."""
    print("\n".join(format_hook_event(hook, width)))
