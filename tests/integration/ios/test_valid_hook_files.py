"""Tests for good case lifecycle on iOS."""

import pytest


@pytest.mark.parametrize("platform", ["ios"], indirect=True)
class TestValidHookFiles:
    """Tests for handling errors on the target related to Java methods."""

    def test_method(self, run_frooky, count_matched_events):
        """Test hooking a single iOS method in a real process."""

        # TODO: will be implemented, once an issue with the local iOS simulator has been fixed.


# TODO: implement more test cases
