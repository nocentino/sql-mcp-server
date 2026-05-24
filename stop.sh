#!/bin/bash

# =====================================================================
# SQL MCP Demo - Stop Script
# =====================================================================

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
