#!/usr/bin/env bash
set -euo pipefail

echo "Installing and running Appium"
npm install -g appium
appium driver install uiautomator2
appium --allow-insecure=uiautomator2:adb_shell &

echo "Waiting for Appium to be ready..."
MAX_RETRIES=60
COUNT=0
until curl --output /dev/null --silent --head --fail http://localhost:4723/status; do
    if [ $COUNT -eq $MAX_RETRIES ]; then
        echo "Error: Appium server failed to start in time."
        exit 1
    fi
    printf '.'
    COUNT=$((COUNT+1))
    sleep 1
done
echo " Appium is UP!"
