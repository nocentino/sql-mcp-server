#!/bin/bash

set -e

echo "Starting SQL MCP demo..."
echo ""

docker compose up --build -d

echo ""
echo "Waiting for SQL Server to be ready..."
until docker compose exec -T sqlserver1 \
  /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa \
  -P "${SA_PASSWORD:-S0methingS@Str0ng!}" -C -Q "SELECT 1" &>/dev/null; do
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
