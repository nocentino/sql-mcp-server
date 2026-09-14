#!/bin/bash

# =====================================================================
# SQL MCP Demo - Stop Script
# =====================================================================

# Always operate on this repo's compose project, regardless of the caller's CWD.
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "=========================================="
echo "Stopping SQL MCP Demo Environment"
echo "=========================================="
echo ""

docker compose down

echo ""
echo "✓ All services stopped"
echo ""
echo "To remove volumes and data, run:"
echo "  docker compose down -v"
echo ""
