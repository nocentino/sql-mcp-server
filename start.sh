#!/bin/bash

set -euo pipefail

# Always operate on this repo's compose project, regardless of the caller's CWD.
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -f .env ]; then
  echo "Missing .env — run: cp .env.example .env  and set the passwords." >&2
  exit 1
fi
if ! grep -Eq '^SA_PASSWORD=.+' .env; then
  echo "SA_PASSWORD is not set in .env." >&2
  exit 1
fi

echo "Starting SQL MCP demo..."
echo ""

# --wait blocks on the same healthchecks and depends_on graph the services
# declare, so readiness is defined in exactly one place (docker-compose.yml).
docker compose up --build -d --wait --wait-timeout 300

echo ""
echo "All services up."
echo ""
echo "  ProductsDB (DAB)    REST/GraphQL/MCP  ->  http://localhost:5001  (MCP: /mcp)"
echo "  DBA monitoring MCP  Streamable HTTP   ->  http://localhost:3001/mcp"
echo "  SQL Server          Direct            ->  localhost:1433 (sqlserver1), localhost:1434 (sqlserver2)"
echo ""
echo "Run ./tests/integration.sh to verify everything is working."
