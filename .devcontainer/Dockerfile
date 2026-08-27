FROM mcr.microsoft.com/devcontainers/base:trixie

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
        python3-pip \
        adb \
        openjdk-21-jdk-headless \
        unzip \
        cmake \
        ninja-build \
    && rm -rf /var/lib/apt/lists/*

ARG USERNAME=vscode

RUN python3 -m venv /opt/venv \
    && chown -R $USERNAME:$USERNAME /opt/venv
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

RUN mkdir -p /commandhistory \
    && touch /commandhistory/.bash_history /commandhistory/.zsh_history \
    && chown -R $USERNAME /commandhistory \
    && echo "export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" >> "/home/$USERNAME/.bashrc" \
    && echo "export HISTFILE=/commandhistory/.zsh_history\nsetopt INC_APPEND_HISTORY" >> "/home/$USERNAME/.zshrc"

# --- Android SDK / NDK / CMake ---
ARG CMDLINE_TOOLS_VERSION=15859902
# Version 36 is required for android-arm-build-tools used in linux/arm64 environments
ARG PLATFORM_VERSION=36
ARG BUILD_TOOLS_VERSION=36.0.0
# NDK 27d
ARG NDK_VERSION=27.0.12077973 
ARG CMAKE_VERSION=3.22.1

ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV ANDROID_HOME=$ANDROID_SDK_ROOT
ENV ANDROID_NDK_HOME=$ANDROID_SDK_ROOT/ndk/${NDK_VERSION}
ENV PATH=$PATH:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_NDK_HOME

ENV ANDROID_BUILD_TOOLS_VERSION=${BUILD_TOOLS_VERSION}
ENV ANDROID_CMAKE_VERSION=${CMAKE_VERSION}


RUN mkdir -p $ANDROID_SDK_ROOT/cmdline-tools \
    && curl -fsSL "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip" -o /tmp/cmdline-tools.zip \ 
    && unzip -q /tmp/cmdline-tools.zip -d $ANDROID_SDK_ROOT/cmdline-tools \
    && mv $ANDROID_SDK_ROOT/cmdline-tools/cmdline-tools $ANDROID_SDK_ROOT/cmdline-tools/latest \
    && rm /tmp/cmdline-tools.zip

RUN yes | sdkmanager --licenses > /dev/null \
    && sdkmanager \
        "platform-tools" \
        "platforms;android-${PLATFORM_VERSION}" \
        "build-tools;${BUILD_TOOLS_VERSION}" \
        "ndk;${NDK_VERSION}" \
        "cmake;${CMAKE_VERSION}" \
    && chown -R $USERNAME:$USERNAME $ANDROID_SDK_ROOT