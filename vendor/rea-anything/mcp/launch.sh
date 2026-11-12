#!/bin/sh
# REA (Reverse Engineer Anything) MCP launcher.
set -eu
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$PLUGIN_ROOT/node_modules/.bin/rea" --mcp
