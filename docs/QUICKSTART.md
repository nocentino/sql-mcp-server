# Quick Start

## 1. Start everything

```bash
docker compose up --build -d
```

Wait ~60 seconds for SQL Server to initialize. Check status:

```bash
docker compose ps
```

All three services should show `healthy` or `running`.

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

Two SQL Server instances (`sqlserver` on port 1433, `sqlserver2` on port 1434) are started by default. The single `sql-dba` MCP server manages both:

```bash
# Verify both instances are healthy
docker compose ps

# Confirm sql-mcp-server registered both at startup
docker logs sql-mcp-dba | grep 'Registered instances'
# Expected: [db] Registered instances: default, sqlserver2
```

Then in Copilot Chat:
```
List all registered SQL Server instances
Get server info for sqlserver2
Check for top waits across all SQL servers
```

## 4. Run the test suite

```bash
./test.sh
```

## 5. Stop

```bash
docker compose down        # keep data
docker compose down -v     # wipe data
```
