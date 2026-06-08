#!/bin/bash

set -e

# Load passwords from .env if not already set in environment
[ -f "$(dirname "${BASH_SOURCE[0]}")/.env" ] && set -a && source "$(dirname "${BASH_SOURCE[0]}")/.env" && set +a

echo "Starting SQL MCP demo..."
echo ""

docker compose up --build -d

echo ""
echo "Waiting for SQL Server to be ready..."
until docker compose exec -T sqlserver1 \
  /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa \
  -P "${SA_PASSWORD}" -C -h -1 -Q "SET NOCOUNT ON; SELECT 'PROBEOK'" 2>/dev/null | grep -q '^PROBEOK'; do
  sleep 3
done
echo "  SQL Server ready"

echo "Waiting for DAB MCP..."
until curl -sf http://localhost:5001/health &>/dev/null; do sleep 3; done
echo "  DAB MCP ready"

echo "Waiting for SQL MCP server..."
until curl -sf http://localhost:3001/health &>/dev/null; do sleep 3; done
echo "  SQL MCP server ready"

echo ""
echo "All services up."
echo ""
echo "  ProductsDB (DAB)    REST/GraphQL/MCP  ->  http://localhost:5001"
echo "  DBA monitoring MCP  SSE               ->  http://localhost:3001/sse"
echo "  SQL Server          Direct            ->  localhost:1433"
echo ""
echo "Run ./tests/integration.sh to verify everything is working."
