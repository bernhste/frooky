import pprint as _pprint

_SEP_LEN = 120
_LINE_MAX = 119
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


def _top_border(label: str, color: str) -> str:
    tag = f" {label} "
    dashes = "─" * (_SEP_LEN - len(tag) - 3)
    return f"{_C_BORDER}┌─{color}{tag}{_C_BORDER}{dashes}┐{_C_RESET}"


def _bot_border() -> str:
    return f"{_C_BORDER}└{'─' * (_SEP_LEN - 2)}┘{_C_RESET}"


def _kv(key: str, val: str) -> str:
    return f"{_C_KEY}{key}{_C_VAL}{val}{_C_RESET}"


def _print_wrapped(line: str, continuation_indent: str) -> None:
    if len(line) <= _LINE_MAX:
        print(line)
        return
    cont = continuation_indent + _WRAP_INDENT
    avail = _LINE_MAX - len(cont)
    print(line[:_LINE_MAX])
    remainder = line[_LINE_MAX:]
    while remainder:
        print(f"{cont}{remainder[:avail]}")
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


def _pprint_indented(v, indent: str) -> None:
    formatted = _pprint.pformat(v, width=_LINE_MAX - len(indent), compact=True)
    for line in formatted.splitlines():
        _print_wrapped(f"{indent}{line}", indent)


def _print_decoded_values(label: str, args: list) -> None:
    continuation = " " * len(label)
    value_indent = continuation + "  "
    for i, a in enumerate(args):
        prefix = label if i == 0 else continuation
        t = a.get("type", "?")
        name = a.get("name")
        _print_wrapped(f"{prefix}{t + ' ' + name if name else t}", continuation)
        v = _unwrap(a.get("value"))
        if v is not None:
            _pprint_indented(v, value_indent)


def _print_return(return_val: dict) -> None:
    if not return_val:
        return
    t = return_val.get("type", "?")
    v = _unwrap(return_val.get("value"))
    print(f"{_LABEL_RET}{t}")
    if t != "void" and v is not None:
        _pprint_indented(v, " " * len(_LABEL_RET) + "  ")


def _print_stack(stack_trace: list) -> None:
    continuation = " " * len(_LABEL_STACK)
    for i, frame in enumerate(stack_trace):
        _print_wrapped(f"{_LABEL_STACK if i == 0 else continuation}{frame}", continuation)


def _pp_hook(hook: dict, label: str, color: str, id_key: str, id_label: str, fn_key: str, fn_label: str) -> None:
    """Shared pretty-printer for Java and native hook events."""
    args_in = hook.get("argsIn") or []
    args_out = hook.get("argsOut") or []
    return_val = hook.get("returnValue")
    stack = hook.get("stackTrace") or []

    print(_top_border(label, color))
    print(_kv("  time      :  ", hook.get("timestamp", "?")))
    print(_kv(f"  {id_label:<10}:  ", hook.get(id_key, "?")))
    print(_kv(f"  {fn_label:<10}:  ", _format_signature(hook.get(fn_key, "?"), args_in)))

    if args_in:
        _print_decoded_values(_LABEL_ARGS_IN, args_in)
    if args_out:
        _print_decoded_values(_LABEL_ARGS_OUT, args_out)
    if return_val:
        _print_return(return_val)
    if stack:
        _print_stack(stack)

    print(_bot_border())


def pp_hook_event(hook: dict) -> None:
    """Pretty-print a NativeHookEvent or JavaHookEvent dict to the CLI."""
    if "java" in hook.get("type", ""):
        field_type = hook.get("fieldType", {})
        ft_str = field_type.get("fieldType", str(field_type)) if isinstance(field_type, dict) else str(field_type)
        _pp_hook(hook, f"java ({ft_str})", _C_TYPE_J, "javaClassName", "class", "method", "method")
    else:
        _pp_hook(hook, "native", _C_TYPE_N, "module", "module", "symbol", "function")
