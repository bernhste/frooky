#!/usr/bin/env bash
set -euo pipefail

ARCH="$(uname -m)"
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    echo "Installing ARM64 Android build tools (v${ANDROID_BUILD_TOOLS_VERSION})..."
    curl -fsSL https://raw.githubusercontent.com/Commit451/android-arm-build-tools/main/install.sh -o /tmp/install.sh
    chmod +x /tmp/install.sh
    /tmp/install.sh --version "${ANDROID_BUILD_TOOLS_VERSION}" --sdk "${ANDROID_SDK_ROOT}"
    rm /tmp/install.sh

    # Symlink native system CMake and Ninja into SDK directory
    mkdir -p "${ANDROID_SDK_ROOT}/cmake/${ANDROID_CMAKE_VERSION}/bin"
    ln -sf /usr/bin/cmake "${ANDROID_SDK_ROOT}/cmake/${ANDROID_CMAKE_VERSION}/bin/cmake"
    ln -sf /usr/bin/ninja "${ANDROID_SDK_ROOT}/cmake/${ANDROID_CMAKE_VERSION}/bin/ninja"

    # Replace NDK with https://github.com/HomuHomu833/android-ndk-custom for alpine linux /arm64 (android-ndk-r27d-aarch64-linux-musl.tar.xz)
    echo "Installing ARM64 Android NDK for alpine linux environments..."
    rm -rf /opt/android-sdk/ndk/27.0.12077973
    mkdir -p /opt/android-sdk/ndk/27.0.12077973
    curl -fsSL https://github.com/HomuHomu833/android-ndk-custom/releases/download/r27/android-ndk-r27d-aarch64-linux-musl.tar.xz -o /opt/android-sdk/android-ndk-r27d-aarch64-linux-musl.tar.xz
    tar -xf /opt/android-sdk/android-ndk-r27d-aarch64-linux-musl.tar.xz -C /opt/android-sdk/ndk/27.0.12077973 --strip-components=1
fi