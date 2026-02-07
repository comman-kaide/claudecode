#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Install system dependencies
if ! command -v ffmpeg &> /dev/null; then
  apt-get update -qq 2>/dev/null || true
  apt-get install -y -qq ffmpeg > /dev/null 2>&1
fi

# Install npm dependencies
cd "$CLAUDE_PROJECT_DIR"
npm install
