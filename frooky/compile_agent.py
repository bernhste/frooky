from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def compile_agent(mode: str) -> None:
    agent_dir = Path(__file__).resolve().parent / "agent"
    if not agent_dir.is_dir():
        sys.exit(f"Agent directory not found: {agent_dir}")

    if not shutil.which("npm"):
        sys.exit("Error: 'npm' not found in PATH. Node.js and npm are required to compile the agent.")

    subprocess.run(["npm", "ci"], cwd=agent_dir, check=True)
    subprocess.run(["npm", "run", f"build:{mode}:android"], cwd=agent_dir, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Compile the frooky TypeScript Frida agent")
    parser.add_argument(
        "--dev",
        dest="mode",
        action="store_const",
        const="dev",
        default="dev",
        help="Build agent in development mode (default)",
    )
    parser.add_argument(
        "--prod",
        dest="mode",
        action="store_const",
        const="prod",
        help="Build agent in production mode",
    )
    args = parser.parse_args()
    compile_agent(args.mode)


if __name__ == "__main__":
    main()
