#!/bin/bash

# Test all endpoints for the SQL MCP demo

DAB_URL="http://localhost:5001"
DBA_URL="http://localhost:3001"
SQL_PASS="${SA_PASSWORD:-S0methingS@Str0ng!}"

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

RESULT=$(docker compose exec -T sqlserver1 \
  /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$SQL_PASS" -C -d ProductsDB \
  -Q "SELECT COUNT(*) FROM dbo.Products" -h -1 2>/dev/null | head -1 | xargs)
[[ "$RESULT" =~ ^[0-9]+$ ]] && ok "ProductsDB reachable ($RESULT products)" || fail "SQL Server connection"

DBA_RESULT=$(docker compose exec -T sqlserver1 \
  /opt/mssql-tools18/bin/sqlcmd -S localhost -U dba_monitor -P "MonitorP@ss123!" -C \
  -Q "SELECT COUNT(*) FROM sys.dm_exec_sessions" -h -1 2>/dev/null | head -1 | xargs)
[[ "$DBA_RESULT" =~ ^[0-9]+$ ]] && ok "dba_monitor can query DMVs ($DBA_RESULT sessions)" || fail "dba_monitor DMV access"

SQL2_RESULT=$(docker compose exec -T sqlserver2 \
  /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$SQL_PASS" -C \
  -Q "SELECT @@SERVERNAME" -h -1 2>/dev/null | xargs)
[ -n "$SQL2_RESULT" ] && ok "sqlserver2 reachable ($SQL2_RESULT)" || fail "sqlserver2 connection"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
echo ""
[ $FAIL -eq 0 ] && exit 0 || exit 1
