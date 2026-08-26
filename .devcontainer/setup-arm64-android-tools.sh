#!/usr/bin/env bash
set -euo pipefail

ARCH="$(uname -m)"
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    SDK_PATH="${ANDROID_SDK_ROOT:-/opt/android-sdk}"

    echo "Installing ARM64 Android build tools (v${ANDROID_BUILD_TOOLS_VERSION})..."
    curl -fsSL https://raw.githubusercontent.com/Commit451/android-arm-build-tools/main/install.sh -o /tmp/install.sh
    chmod +x /tmp/install.sh
    /tmp/install.sh --version "${ANDROID_BUILD_TOOLS_VERSION}" --sdk "${SDK_PATH}"
    rm /tmp/install.sh

    # Symlink native system CMake and Ninja into SDK directory
    mkdir -p "${SDK_PATH}/cmake/${ANDROID_CMAKE_VERSION}/bin"
    ln -sf /usr/bin/cmake "${SDK_PATH}/cmake/${ANDROID_CMAKE_VERSION}/bin/cmake"
    ln -sf /usr/bin/ninja "${SDK_PATH}/cmake/${ANDROID_CMAKE_VERSION}/bin/ninja"

    # Configure Gradle override inside the mounted volume
    mkdir -p /home/vscode/.gradle
    GRADLE_PROP="/home/vscode/.gradle/gradle.properties"
    OVERRIDE_KEY="android.aapt2FromMavenOverride"
    
    if grep -q "${OVERRIDE_KEY}" "${GRADLE_PROP}" 2>/dev/null; then
        sed -i "s|${OVERRIDE_KEY}=.*|${OVERRIDE_KEY}=${SDK_PATH}/build-tools/${ANDROID_BUILD_TOOLS_VERSION}/aapt2|" "${GRADLE_PROP}"
    else
        echo "${OVERRIDE_KEY}=${SDK_PATH}/build-tools/${ANDROID_BUILD_TOOLS_VERSION}/aapt2" >> "${GRADLE_PROP}"
    fi
fi