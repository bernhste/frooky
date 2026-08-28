#!/usr/bin/env bash
set -euo pipefail

# run as the remote user so files stay writable by the nvm group
su "${_REMOTE_USER}" -c "npm install -g appium@${VERSION}"