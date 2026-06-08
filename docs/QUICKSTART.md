# Quick Start

## 1. Start everything

```bash
./start.sh
```

This builds the `sql-mcp-server` image if needed, starts all containers, and waits until SQL Server, DAB, and the MCP server are all healthy. Check status:

```bash
docker compose ps
```

The two SQL Server containers and the two MCP server containers should show `healthy`. The two init containers (`sql-mcp-init`, `sql-mcp-init-sqlserver2`) will show `Exited (0)` — that is expected; they seed the database once and stop.

## 2. Verify endpoints

```bash
curl http://localhost:5001/health   # DAB — ProductsDB
curl http://localhost:3001/health   # SQL MCP Server — DBA monitoring
```

## 3. Connect your AI agent

Edit `~/Library/Application Support/Code/User/mcp.json` (create it if it does not exist):

```json
{
  "servers": {
    "products-db": {
      "type": "http",
      "url": "http://localhost:5001/mcp"
    },
    "sql-dba": {
      "type": "http",
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

Reload the MCP servers in VS Code (`⇧⌘P` → `Developer: Reload Window`), then try:

```
List all SQL Server instances
Check wait stats on the default instance
Run the same wait stats query across all SQL servers at once
@products-db  Show me all products with low stock
```

## 4. Explore multi-instance monitoring

Two SQL Server instances are started by default: `sqlserver1` on port 1433, `sqlserver2` on port 1434. The single `sql-dba` MCP server manages both. Verify:

```bash
docker compose ps
```

Then in Copilot Chat (agent mode):

```
List all registered SQL Server instances
Get server info for SqlServer2
Check wait stats on both SQL Server instances and summarize any concerns
```

## 5. Run the test suite

```bash
./tests/integration.sh
```

## 6. Stop

```bash
docker compose down        # keep data
docker compose down -v     # wipe data
```
