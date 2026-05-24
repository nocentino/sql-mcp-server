# MCP Client Configuration

This project exposes two MCP servers. Configure both in your AI client.

## VS Code / GitHub Copilot

User-level config at `~/Library/Application Support/Code/User/mcp.json`.
Note: standalone `mcp.json` uses `{"servers":{...}}` directly — no outer `"mcp"` wrapper.

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

## Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "products-db": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:5001/mcp"]
    },
    "sql-dba": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3001/mcp"]
    }
  }
}
```

## Example prompts — products-db (DAB / ProductsDB)

```
Show me all products in the Electronics category
Which products have fewer than 30 units in stock?
Create a new product: 'Mechanical Keyboard', Electronics, $89.99, 40 units
What is the total inventory value by category?
Show me all orders from customer Jane Doe
```

## Example prompts — sql-dba (SQL MCP Server / DMV monitoring)

```
# Single instance (defaults to "default")
Are there any blocking sessions right now?
What are the top 10 queries by CPU since the server restarted?
Show me file I/O latency — are any files slow?
What is SQL Server's memory breakdown? Any grant pressure?
What indexes are never used and could be dropped?
Show me the CPU history for the last hour
Which databases have the largest log files?
Run this query: SELECT session_id, login_name, cpu_time FROM sys.dm_exec_sessions WHERE is_user_process=1

# Multi-instance
List all registered SQL Server instances
Get server info for sqlserver2
Are there any blocking sessions on sqlserver2?
Check for top wait stats across all SQL servers
Run the same CPU history query on every instance at once and compare
```

## Testing connectivity

```bash
# DAB health
curl http://localhost:5001/health

# SQL MCP server health
curl http://localhost:3001/health

# Test initialize handshake (DAB)
curl -s -X POST http://localhost:5001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}'

# Test initialize handshake (sql-dba)
curl -s -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}'
```

## Troubleshooting

**Tools not appearing in Copilot** — reload MCP servers: VS Code command palette → "MCP: Restart Server"

**Connection refused** — confirm containers are running: `docker compose ps`

**sql-dba returns SQL errors** — the `dba_monitor` account needs `VIEW SERVER STATE`. On the containerized demo this is handled automatically by `init-sqlserver1.sql`. On an external SQL Server, run:
```sql
GRANT VIEW SERVER STATE   TO your_login;
GRANT VIEW DATABASE STATE TO your_login;
```
