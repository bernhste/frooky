# TODO: Refactoring (currently lots of LLM slop and code duplications)

import pprint as _pprint

_SEP_LEN = 160
_LINE_MAX = 159
_WRAP_INDENT = "    "  # 4-space indent to signal a line break continuation
_LABEL_ARGS_IN = "  args in   :  "
_LABEL_ARGS_OUT = "  args out  :  "
_LABEL_RET = "  returns   :  "
_LABEL_STACK = "  stack     :  "

# ANSI colors
_C_RESET = "\033[0m"
_C_BORDER = "\033[36m"  # cyan - box borders
_C_KEY = "\033[37m"  # light grey - field labels
_C_VAL = "\033[97m"  # bright white - values
_C_TYPE_J = "\033[35m"  # magenta - java type tag
_C_TYPE_N = "\033[32m"  # green - native type tag


def _top_border(label: str, color: str) -> str:
    tag = f" {label} "
    dashes = "─" * (_SEP_LEN - len(tag) - 3)
    return f"{_C_BORDER}┌─{color}{tag}{_C_BORDER}{dashes}┐{_C_RESET}"


def _bot_border() -> str:
    return f"{_C_BORDER}└{'─' * (_SEP_LEN - 2)}┘{_C_RESET}"


def _kv(key: str, val: str) -> str:
    return f"{_C_KEY}{key}{_C_VAL}{val}{_C_RESET}"


def _print_wrapped(line: str, continuation_indent: str):
    """Hard-break line at _LINE_MAX chars; continuation lines get 4 extra spaces."""
    if len(line) <= _LINE_MAX:
        print(line)
        return
    cont = continuation_indent + _WRAP_INDENT
    print(line[:_LINE_MAX])
    remainder = line[_LINE_MAX:]
    # available width for continuation lines
    avail = _LINE_MAX - len(cont)
    while remainder:
        print(f"{cont}{remainder[:avail]}")
        remainder = remainder[avail:]


def _pprint_indented(v, indent):
    formatted = _pprint.pformat(_deep_unwrap(v), width=_LINE_MAX - len(indent), compact=True)
    for line in formatted.splitlines():
        _print_wrapped(f"{indent}{line}", indent)


def _deep_unwrap(v):
    if isinstance(v, dict) and "value" in v and set(v.keys()) <= {"type", "value", "name"}:
        return _deep_unwrap(v["value"])
    if isinstance(v, list):
        return [_deep_unwrap(i) for i in v]
    return v


def _extract_value(v):
    if isinstance(v, dict) and set(v.keys()) <= {"type", "value", "name"}:
        return v.get("value")
    return v


def _format_function_or_method(name: str, args: list) -> str:
    if not args:
        return f"{name}()"
    params = ", ".join(f"{a.get('type', '?')} {a['name']}" if a.get("name") else a.get("type", "?") for a in args)
    return f"{name}({params})"


def _extract_value(v):
    """Recursively unwrap {type, name, value} structures to plain values."""
    if v is None:
        return None
    if isinstance(v, dict):
        if "value" in v:
            return _extract_value(v["value"])
        # Plain dict (already unwrapped map) - recurse into values
        return {k: _extract_value(val) for k, val in v.items()}
    if isinstance(v, list):
        return [_extract_value(item) for item in v]
    return v


def _print_decoded_values(label: str, args: list):
    continuation = " " * len(label)
    value_indent = continuation + "  "
    for i, a in enumerate(args):
        prefix = label if i == 0 else continuation
        t = a.get("type", "?")
        name = a.get("name")

        arg_label = f"{t} {name}" if name else t
        _print_wrapped(f"{prefix}{arg_label}", continuation)

        v = _extract_value(a.get("value"))
        if v is not None and not (isinstance(v, str) and v == "?"):
            _pprint_indented(v, value_indent)


def _print_return(return_val: dict):
    if not return_val:
        return
    t = return_val.get("type", "?")
    v = _extract_value(return_val.get("value"))

    if t == "void" or v is None or (isinstance(v, str) and v == "?"):
        print(f"  returns   :  {t}")
        return

    continuation = " " * len(_LABEL_RET)
    value_indent = continuation + "  "
    print(f"{_LABEL_RET}{t}")
    _pprint_indented(v, value_indent)


def _print_stack(stack_trace: list):
    continuation = " " * len(_LABEL_STACK)
    for i, frame in enumerate(stack_trace):
        indent = _LABEL_STACK if i == 0 else continuation
        _print_wrapped(f"{indent}{frame}", continuation)


def _pp_java(hook: dict):
    classname = hook.get("javaClassName", "?")
    method = hook.get("method", "?")
    field_type = hook.get("fieldType", {})
    timestamp = hook.get("timestamp", "?")
    args_in = hook.get("argsIn") or []
    args_out = hook.get("argsOut") or []
    return_val = hook.get("returnValue")
    stack_trace = hook.get("stackTrace") or []

    if isinstance(field_type, dict):
        ft_str = field_type.get("fieldType", str(field_type))
    else:
        ft_str = str(field_type)

    label = f"java ({ft_str})"
    print(_top_border(label, _C_TYPE_J))
    print(_kv("  time      :  ", timestamp))
    print(_kv("  class     :  ", classname))
    print(_kv("  method    :  ", _format_function_or_method(method, args_in)))

    if args_in:
        _print_decoded_values(_LABEL_ARGS_IN, args_in)
    if args_out:
        _print_decoded_values(_LABEL_ARGS_OUT, args_out)
    if return_val:
        _print_return(return_val)
    if stack_trace:
        _print_stack(stack_trace)

    print(_bot_border())


def _pp_native(hook: dict):
    module = hook.get("module", "?")
    symbol = hook.get("symbol", "?")
    timestamp = hook.get("timestamp", "?")
    args_in = hook.get("argsIn") or []
    args_out = hook.get("argsOut") or []
    return_val = hook.get("returnValue")
    stack_trace = hook.get("stackTrace") or []

    print(_top_border("native", _C_TYPE_N))
    print(_kv("  time      :  ", timestamp))
    print(_kv("  module    :  ", module))
    print(_kv("  function  :  ", _format_function_or_method(symbol, args_in)))

    if args_in:
        _print_decoded_values(_LABEL_ARGS_IN, args_in)
    if args_out:
        _print_decoded_values(_LABEL_ARGS_OUT, args_out)
    if return_val:
        _print_return(return_val)
    if stack_trace:
        _print_stack(stack_trace)

    print(_bot_border())


def pp_hook_event(hook: dict):
    """Pretty-print a NativeHookEvent or JavaHookEvent dict to the CLI."""
    if "java" in hook.get("type", ""):
        _pp_java(hook)
    else:
        _pp_native(hook)


def pp_hook_events(hooks: list):
    for hook in hooks:
        pp_hook_event(hook)
