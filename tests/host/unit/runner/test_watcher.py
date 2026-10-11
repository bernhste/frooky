"""Unit tests for polling hook files for changes."""

import os

from frooky.runner.watcher import HookFileWatcher


def _rewrite(path, content):
    """Write new content and bump the mtime, which a rewrite within the same tick might otherwise not change."""
    path.write_text(content)
    st = path.stat()
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000))


class TestHookFileWatcher:
    def test_loads_initial_configs_in_path_order(self, tmp_path):
        first = tmp_path / "first.yaml"
        first.write_text("name: first\n")
        second = tmp_path / "second.yaml"
        second.write_text("name: second\n")

        watcher = HookFileWatcher([first, second])

        assert watcher.configs == [{"name": "first"}, {"name": "second"}]

    def test_reports_nothing_when_unchanged(self, tmp_path):
        hook_file = tmp_path / "hooks.yaml"
        hook_file.write_text("a: 1\n")
        watcher = HookFileWatcher([hook_file])

        assert watcher.poll() == []

    def test_reports_only_the_changed_file_once(self, tmp_path):
        first = tmp_path / "first.yaml"
        first.write_text("a: 1\n")
        second = tmp_path / "second.yaml"
        second.write_text("b: 1\n")
        watcher = HookFileWatcher([first, second])

        _rewrite(second, "b: 2\n")

        assert watcher.poll() == [(second, {"b": 2})]
        assert watcher.poll() == []

    def test_ignores_changes_that_do_not_change_the_parsed_content(self, tmp_path):
        hook_file = tmp_path / "hooks.yaml"
        hook_file.write_text("a: 1\n")
        watcher = HookFileWatcher([hook_file])

        _rewrite(hook_file, "# a comment\na:   1\n")

        assert watcher.poll() == []

    def test_reports_parse_errors_and_keeps_previous_version(self, tmp_path):
        hook_file = tmp_path / "hooks.yaml"
        hook_file.write_text("a: 1\n")
        errors = []
        watcher = HookFileWatcher([hook_file], on_error=lambda path, e: errors.append(path))

        _rewrite(hook_file, "a: [unclosed\n")
        assert watcher.poll() == []
        assert errors == [hook_file]

        # the broken version never replaced the loaded one, so reverting the edit is not a change
        _rewrite(hook_file, "a: 1\n")
        assert watcher.poll() == []

    def test_skips_a_temporarily_missing_file(self, tmp_path):
        hook_file = tmp_path / "hooks.yaml"
        hook_file.write_text("a: 1\n")
        watcher = HookFileWatcher([hook_file])

        hook_file.unlink()
        assert watcher.poll() == []

        hook_file.write_text("a: 2\n")
        assert watcher.poll() == [(hook_file, {"a": 2})]

    def test_detects_atomic_save_by_rename(self, tmp_path):
        hook_file = tmp_path / "hooks.yaml"
        hook_file.write_text("a: 1\n")
        watcher = HookFileWatcher([hook_file])
        st = hook_file.stat()

        tmp_file = tmp_path / ".hooks.yaml.tmp"
        tmp_file.write_text("a: 3\n")
        # same size and mtime as the original, only the inode differs
        os.utime(tmp_file, ns=(st.st_atime_ns, st.st_mtime_ns))
        os.replace(tmp_file, hook_file)

        assert watcher.poll() == [(hook_file, {"a": 3})]
