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
    GRADLE_PROP="/home/vscode/.gradle/gradle.properties"
    OVERRIDE_KEY="android.aapt2FromMavenOverride"
    
    if grep -q "${OVERRIDE_KEY}" "${GRADLE_PROP}" 2>/dev/null; then
        sed -i "s|${OVERRIDE_KEY}=.*|${OVERRIDE_KEY}=${SDK_PATH}/build-tools/${ANDROID_BUILD_TOOLS_VERSION}/aapt2|" "${GRADLE_PROP}"
    else
        echo "${OVERRIDE_KEY}=${SDK_PATH}/build-tools/${ANDROID_BUILD_TOOLS_VERSION}/aapt2" >> "${GRADLE_PROP}"
    fi

    # Replace NDK with https://github.com/HomuHomu833/android-ndk-custom for alpine linux /arm64 (android-ndk-r27d-aarch64-linux-musl.tar.xz)
    echo "Installing ARM64 Android NDK for alpine linux environments..."
    rm -rf /opt/android-sdk/ndk/27.0.12077973
    mkdir -p /opt/android-sdk/ndk/27.0.12077973
    curl -fsSL https://github.com/HomuHomu833/android-ndk-custom/releases/download/r27/android-ndk-r27d-aarch64-linux-musl.tar.xz -o /opt/android-sdk/android-ndk-r27d-aarch64-linux-musl.tar.xz
    tar -xf /opt/android-sdk/android-ndk-r27d-aarch64-linux-musl.tar.xz -C /opt/android-sdk/ndk/27.0.12077973 --strip-components=1
fi