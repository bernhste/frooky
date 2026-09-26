import pprint as _pprint

_DEFAULT_WIDTH = 120
_MIN_WIDTH = 60
_WRAP_INDENT = "    "
_LABEL_ARGS_IN = "  args in   :  "
_LABEL_ARGS_OUT = "  args out  :  "
_LABEL_RET = "  returns   :  "
_LABEL_STACK = "  stack     :  "

_C_RESET = "\033[0m"
_C_BORDER = "\033[36m"
_C_KEY = "\033[37m"
_C_VAL = "\033[97m"
_C_TYPE_J = "\033[35m"
_C_TYPE_N = "\033[32m"

# A decoder's output is an envelope of exactly these keys (see DecodedValue in the TS agent);
# "name" is optional. Anything matching this shape gets unwrapped down to its leaf value below.
_DECODED_VALUE_KEYS = {"type", "value", "name"}


def _top_border(label: str, color: str, width: int) -> str:
    tag = f" {label} "
    dashes = "─" * max(width - len(tag) - 3, 0)
    return f"{_C_BORDER}┌─{color}{tag}{_C_BORDER}{dashes}┐{_C_RESET}"


def _bot_border(width: int) -> str:
    return f"{_C_BORDER}└{'─' * (width - 2)}┘{_C_RESET}"


def _kv(key: str, val: str) -> str:
    return f"{_C_KEY}{key}{_C_VAL}{val}{_C_RESET}"


class _Lines:
    """Collects the lines of one event box, wrapping long lines to the box width."""

    def __init__(self, width: int):
        self.width = width
        self.line_max = width - 1
        self.lines: list[str] = []

    def add(self, line: str) -> None:
        self.lines.append(line)

    def add_wrapped(self, line: str, continuation_indent: str) -> None:
        if len(line) <= self.line_max:
            self.lines.append(line)
            return
        cont = continuation_indent + _WRAP_INDENT
        avail = max(self.line_max - len(cont), 1)
        self.lines.append(line[: self.line_max])
        remainder = line[self.line_max :]
        while remainder:
            self.lines.append(f"{cont}{remainder[:avail]}")
            remainder = remainder[avail:]


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


def _pprint_indented(out: _Lines, v, indent: str) -> None:
    formatted = _pprint.pformat(v, width=max(out.line_max - len(indent), 20), compact=True)
    for line in formatted.splitlines():
        out.add_wrapped(f"{indent}{line}", indent)


def _add_decoded_values(out: _Lines, label: str, args: list) -> None:
    continuation = " " * len(label)
    value_indent = continuation + "  "
    for i, a in enumerate(args):
        prefix = label if i == 0 else continuation
        t = a.get("type", "?")
        name = a.get("name")
        out.add_wrapped(f"{prefix}{t + ' ' + name if name else t}", continuation)
        v = _unwrap(a.get("value"))
        if v is not None:
            _pprint_indented(out, v, value_indent)


def _add_return(out: _Lines, return_val: dict) -> None:
    if not return_val:
        return
    t = return_val.get("type", "?")
    v = _unwrap(return_val.get("value"))
    out.add(f"{_LABEL_RET}{t}")
    if t != "void" and v is not None:
        _pprint_indented(out, v, " " * len(_LABEL_RET) + "  ")


def _add_stack(out: _Lines, stack_trace: list) -> None:
    continuation = " " * len(_LABEL_STACK)
    for i, frame in enumerate(stack_trace):
        out.add_wrapped(f"{_LABEL_STACK if i == 0 else continuation}{frame}", continuation)


def _format_hook(out: _Lines, hook: dict, label: str, color: str, id_key: str, id_label: str, fn_key: str, fn_label: str) -> None:
    """Shared formatter for Java and native hook events."""
    args_in = hook.get("argsIn") or []
    args_out = hook.get("argsOut") or []
    return_val = hook.get("returnValue")
    stack = hook.get("stackTrace") or []

    out.add(_top_border(label, color, out.width))
    out.add(_kv("  time      :  ", hook.get("timestamp", "?")))
    out.add(_kv(f"  {id_label:<10}:  ", hook.get(id_key, "?")))
    out.add(_kv(f"  {fn_label:<10}:  ", _format_signature(hook.get(fn_key, "?"), args_in)))

    if args_in:
        _add_decoded_values(out, _LABEL_ARGS_IN, args_in)
    if args_out:
        _add_decoded_values(out, _LABEL_ARGS_OUT, args_out)
    if return_val:
        _add_return(out, return_val)
    if stack:
        _add_stack(out, stack)

    out.add(_bot_border(out.width))


def format_hook_event(hook: dict, width: int = _DEFAULT_WIDTH) -> list[str]:
    """Format a NativeHookEvent or JavaHookEvent dict as the lines of a box `width` columns wide, with ANSI colors."""
    out = _Lines(max(width, _MIN_WIDTH))
    if "java" in hook.get("type", ""):
        field_type = hook.get("fieldType", {})
        ft_str = field_type.get("fieldType", str(field_type)) if isinstance(field_type, dict) else str(field_type)
        _format_hook(out, hook, f"java ({ft_str})", _C_TYPE_J, "javaClassName", "class", "method", "method")
    else:
        _format_hook(out, hook, "native", _C_TYPE_N, "module", "module", "symbol", "function")
    return out.lines


def pp_hook_event(hook: dict, width: int = _DEFAULT_WIDTH) -> None:
    """Pretty-print a NativeHookEvent or JavaHookEvent dict to stdout."""
    print("\n".join(format_hook_event(hook, width)))
