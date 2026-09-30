from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from frooky.compile_agent import compile_agent, main


class TestCompileAgent:
    @patch("shutil.which", return_value="/usr/bin/npm")
    @patch("subprocess.run")
    def test_compile_agent_dev(self, mock_run, _mock_which):
        compile_agent("dev")
        agent_dir = Path(__file__).resolve().parent.parent.parent / "frooky" / "agent"
        assert mock_run.call_count == 2
        mock_run.assert_any_call(["npm", "ci"], cwd=agent_dir, check=True)
        mock_run.assert_any_call(["npm", "run", "build:dev:android"], cwd=agent_dir, check=True)

    @patch("shutil.which", return_value="/usr/bin/npm")
    @patch("subprocess.run")
    def test_compile_agent_prod(self, mock_run, _mock_which):
        compile_agent("prod")
        agent_dir = Path(__file__).resolve().parent.parent.parent / "frooky" / "agent"
        assert mock_run.call_count == 2
        mock_run.assert_any_call(["npm", "ci"], cwd=agent_dir, check=True)
        mock_run.assert_any_call(["npm", "run", "build:prod:android"], cwd=agent_dir, check=True)

    @patch("shutil.which", return_value=None)
    def test_compile_agent_missing_npm(self, _mock_which):
        with pytest.raises(SystemExit, match="npm.*not found"):
            compile_agent("dev")

    @patch("pathlib.Path.is_dir", return_value=False)
    def test_compile_agent_missing_dir(self, _mock_is_dir):
        with pytest.raises(SystemExit, match="Agent directory not found"):
            compile_agent("dev")

    @patch("frooky.compile_agent.compile_agent")
    def test_main_default_dev(self, mock_compile, monkeypatch):
        monkeypatch.setattr("sys.argv", ["compile-agent"])
        main()
        mock_compile.assert_called_once_with("dev")

    @patch("frooky.compile_agent.compile_agent")
    def test_main_explicit_dev(self, mock_compile, monkeypatch):
        monkeypatch.setattr("sys.argv", ["compile-agent", "--dev"])
        main()
        mock_compile.assert_called_once_with("dev")

    @patch("frooky.compile_agent.compile_agent")
    def test_main_prod(self, mock_compile, monkeypatch):
        monkeypatch.setattr("sys.argv", ["compile-agent", "--prod"])
        main()
        mock_compile.assert_called_once_with("prod")
