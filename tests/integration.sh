#!/bin/bash

# Test all endpoints for the SQL MCP demo

DAB_URL="http://localhost:5001"
DBA_URL="http://localhost:3001"

# Load passwords from .env if not already set in environment
[ -f "$(dirname "${BASH_SOURCE[0]}")/../.env" ] && set -a && source "$(dirname "${BASH_SOURCE[0]}")/../.env" && set +a

SQL_PASS="${SA_PASSWORD:?SA_PASSWORD not set}"
MONITOR_PASSWORD="${MONITOR_PASSWORD:?MONITOR_PASSWORD not set}"

PASS=0; FAIL=0
ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
fail(){ echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

echo ""
echo "=== SQL MCP Demo — endpoint tests ==="
echo ""

# ── Services running ────────────────────────────────────────
echo "Services"
docker compose ps | grep -q "Up\|running" && ok "containers up" || fail "containers not running"
echo ""

# ── DAB ─────────────────────────────────────────────────────
echo "DAB MCP (ProductsDB) — $DAB_URL"

CODE=$(curl -sf -o /dev/null -w "%{http_code}" $DAB_URL/health 2>/dev/null)
[ "$CODE" = "200" ] && ok "health" || fail "health (got $CODE)"

COUNT=$(curl -sf $DAB_URL/api/Products 2>/dev/null | grep -o "ProductID" | wc -l | xargs)
[ "${COUNT:-0}" -gt 0 ] && ok "REST /api/Products ($COUNT rows)" || fail "REST /api/Products"

GQL=$(curl -sf -X POST $DAB_URL/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ products(first:3) { items { ProductID } } }"}' 2>/dev/null)
echo "$GQL" | grep -q "ProductID" && ok "GraphQL products" || fail "GraphQL products"

echo ""

# ── SQL MCP server ───────────────────────────────────────────
echo "SQL MCP Server (DBA) — $DBA_URL"

CODE=$(curl -sf -o /dev/null -w "%{http_code}" $DBA_URL/health 2>/dev/null)
[ "$CODE" = "200" ] && ok "health" || fail "health (got $CODE)"

echo ""

# ── SQL Server direct ────────────────────────────────────────
echo "SQL Server direct"

RESULT=$(docker compose exec -T -e SQLCMDPASSWORD="$SQL_PASS" sqlserver1 \
  /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -d ProductsDB \
  -Q "SELECT COUNT(*) FROM dbo.Products" -h -1 2>/dev/null | head -1 | xargs)
[[ "$RESULT" =~ ^[0-9]+$ ]] && ok "ProductsDB reachable ($RESULT products)" || fail "SQL Server connection"

DBA_RESULT=$(docker compose exec -T -e SQLCMDPASSWORD="${MONITOR_PASSWORD}" sqlserver1 \
  /opt/mssql-tools18/bin/sqlcmd -S localhost -U dba_monitor -C \
  -Q "SELECT COUNT(*) FROM sys.dm_exec_sessions" -h -1 2>/dev/null | head -1 | xargs)
[[ "$DBA_RESULT" =~ ^[0-9]+$ ]] && ok "dba_monitor can query DMVs ($DBA_RESULT sessions)" || fail "dba_monitor DMV access"

SQL2_RESULT=$(docker compose exec -T -e SQLCMDPASSWORD="$SQL_PASS" sqlserver2 \
  /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C \
  -Q "SELECT @@SERVERNAME" -h -1 2>/dev/null | xargs)
[ -n "$SQL2_RESULT" ] && ok "sqlserver2 reachable ($SQL2_RESULT)" || fail "sqlserver2 connection"

echo ""

# ── Row-limit / truncation regression (v1.1.0) ───────────────
# Runs over the real MCP protocol. Prefers a host node; falls back to the same
# containerised invocation mcp-integration.mjs documents.
echo "Row-limit / truncation regression"

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if command -v node >/dev/null 2>&1; then
  MCP_URL="$DBA_URL" node "$TESTS_DIR/truncation-regression.mjs" >/tmp/trunc-regression.$$ 2>&1
  RC=$?
elif command -v docker >/dev/null 2>&1; then
  docker run --rm -e MCP_URL=http://host.docker.internal:3001 \
    -v "$TESTS_DIR:/tests:ro" node:22-alpine \
    node /tests/truncation-regression.mjs >/tmp/trunc-regression.$$ 2>&1
  RC=$?
else
  RC=127
fi

if [ $RC -eq 0 ]; then
  ok "truncation regression ($(grep -cE '^  PASS' /tmp/trunc-regression.$$) checks)"
  grep -E '^  SKIP' /tmp/trunc-regression.$$ | sed 's/^  SKIP/    skipped:/'
elif [ $RC -eq 127 ]; then
  fail "truncation regression (neither node nor docker available)"
else
  fail "truncation regression — failing checks:"
  grep -E '^  FAIL' /tmp/trunc-regression.$$ | sed 's/^/    /'
fi
rm -f /tmp/trunc-regression.$$

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
echo ""
[ $FAIL -eq 0 ] && exit 0 || exit 1
