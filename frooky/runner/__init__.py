"""Runner package: orchestrates Frida device connection, config/script loading, and message handling."""

from .options import RunnerOptions

__all__ = ["FrookyRunner", "RunnerOptions"]


def __getattr__(name: str):
    if name == "FrookyRunner":
        from .runner import FrookyRunner

        return FrookyRunner
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
