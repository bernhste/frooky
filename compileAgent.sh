#!/bin/bash
set -e

exec uv run compile-agent "$@"

