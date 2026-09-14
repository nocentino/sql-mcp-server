#!/bin/bash
# Integration test suite for all 34 SQL MCP server tools.
# Delegates to tests/mcp-integration.mjs via Node 22 in Docker.
#
# Prerequisites: server running on localhost:3001 (docker compose up -d)
# Usage: ./test-mcp-tools.sh [MCP_URL]
#
# Override server URL: ./test-mcp-tools.sh http://localhost:3001

set -euo pipefail

BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

MCP_URL="${1:-http://sql-mcp-dba:3000}"
# The compose network is named after the project (directory) — discover it
# instead of hard-coding a project name.
NETWORK="$(docker network ls --filter name=sql-mcp-network --format '{{.Name}}' | head -1)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_FILE="${SCRIPT_DIR}/mcp-integration.mjs"

if [[ ! -f "$TEST_FILE" ]]; then
  echo -e "${RED}ERROR: $TEST_FILE not found${NC}"
  exit 1
fi

echo -e "${BLUE}=== SQL MCP Tool Integration Tests ===${NC}"
echo "MCP server: $MCP_URL"
echo "Test file:  $TEST_FILE"
echo

# Health check before running tests
echo -n "Health check... "
if ! curl -sf "http://localhost:3001/health" > /dev/null 2>&1; then
  echo -e "${RED}FAILED — is the server running? (docker compose up -d)${NC}"
  exit 1
fi
echo -e "${GREEN}OK${NC}"
echo

docker run --rm \
  --network "${NETWORK:?compose network sql-mcp-network not found — is the stack running?}" \
  -e MCP_URL="$MCP_URL" \
  -v "${SCRIPT_DIR}:/tests:ro" \
  node:22-alpine node /tests/mcp-integration.mjs
