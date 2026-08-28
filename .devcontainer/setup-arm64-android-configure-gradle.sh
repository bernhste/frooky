#!/usr/bin/env bash
set -euo pipefail

ARCH="$(uname -m)"
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    # Configure Gradle override inside the mounted volume
    GRADLE_PROP="/home/vscode/.gradle/gradle.properties"
    OVERRIDE_KEY="android.aapt2FromMavenOverride"
    
    if grep -q "${OVERRIDE_KEY}" "${GRADLE_PROP}" 2>/dev/null; then
        sed -i "s|${OVERRIDE_KEY}=.*|${OVERRIDE_KEY}=${ANDROID_SDK_ROOT}/build-tools/${ANDROID_BUILD_TOOLS_VERSION}/aapt2|" "${GRADLE_PROP}"
    else
        echo "${OVERRIDE_KEY}=${ANDROID_SDK_ROOT}/build-tools/${ANDROID_BUILD_TOOLS_VERSION}/aapt2" >> "${GRADLE_PROP}"
    fi
fi

