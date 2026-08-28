"""Tests for various valid hook files on Android."""
import pytest

@pytest.mark.parametrize("platform", ["android"], indirect=True)
class TestValidHookFiles:
    """Tests for handling errors on the target related to Java methods."""

    def test_single_method(self, run_frooky, count_matched_events):
        """Test hooking a single Java method in a real process."""

        hook_file = {"category": "STORAGE", "hooks": [{"class": "org.owasp.mastestapp.MastgTest", "methods": ["receiveString"]}]}

        target_app = "value-passing-java"

        run_frooky(hook_file, target_app)

        expected_pattern = {
            "class": "org.owasp.mastestapp.MastgTest",
            "method": "receiveString",
        }

        assert count_matched_events(expected_pattern) == 1, "Not the amount of expected matched events found."


#TODO: implement more test cases