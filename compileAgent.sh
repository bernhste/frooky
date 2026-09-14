#!/bin/bash
set -e

cd ./frooky/agent
npm ci

case "$1" in
    --prod)
        npm run build:prod:android
        ;;
    --dev)
        npm run build:dev:android
        ;;
    *)
        echo "Usage: $0 {--prod|--dev}"
        exit 1
        ;;
esac
