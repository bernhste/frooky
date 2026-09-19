#!/bin/bash
set -e

cd ./frooky/agent
npm ci

# optional second argument selects the platform, both are built by default
case "$2" in
    "")
        PLATFORMS="android ios"
        ;;
    android|ios)
        PLATFORMS="$2"
        ;;
    *)
        echo "Usage: $0 {--prod|--dev} [android|ios]"
        exit 1
        ;;
esac

case "$1" in
    --prod)
        MODE="prod"
        ;;
    --dev)
        MODE="dev"
        ;;
    *)
        echo "Usage: $0 {--prod|--dev} [android|ios]"
        exit 1
        ;;
esac

for PLATFORM in $PLATFORMS; do
    npm run "build:$MODE:$PLATFORM"
done
