#!/bin/bash
############################################################################################################
# 5. One MCP Server, Many SQL Server Instances
#    Architecture plan and migration walkthrough.
#
#    CURRENT (one server, one instance):
#
#      ┌──────────────────────┐
#      │     sql-dba          │   SQL_SERVER=sqlserver
#      │  sql-mcp-server      │──────────────────────► sqlserver:1433
#      │     port 3001        │
#      └──────────────────────┘
#
#    TARGET (one server, many instances):
#
#      ┌──────────────────────────────────────────┐
#      │            sql-dba                       │
#      │         sql-mcp-server                   │
#      │            port 3001                     │
#      │                                          │
#      │   connectionManager.ts                   │
#      │   ┌─────────┬───────────┬─────────┐      │
#      │   │SqlServer1│  prod    │   dev   │      │
#      │   │  pool   │   pool    │   pool  │      │
#      │   └────┬────┴─────┬─────┴────┬────┘      │
#      └────────┼──────────┼──────────┼───────────┘
#               │          │          │
#               ▼          ▼          ▼
#         sqlserver   prod-sql01  dev-sql01
#           :1433       :1433       :1433
#
#    mcp.json stays the same — still one entry "sql-dba".
#    Copilot picks the right instance by name in its tool calls.
############################################################################################################


############################################################################################################
# What changed in the codebase
############################################################################################################

# NEW file: src/connectionManager.ts
# Replaces the single global pool in db.ts with a named-pool map.
# Loads instances from INSTANCES env var (JSON array) or falls back
# to SQL_SERVER/SQL_USER/SQL_PASSWORD for backwards compatibility.

code sql-mcp-server/src/connectionManager.ts


############################################################################################################
# The INSTANCES env var — configure the fleet
#
#   INSTANCES=[
#     {"name":"SqlServer1","host":"sqlserver", "port":1433,"user":"dba_monitor","password":"MonitorP@ss123!"},
#     {"name":"prod",   "host":"prod-sql01","port":1433,"user":"dba_monitor","password":"..."},
#     {"name":"dev",    "host":"dev-sql01", "port":1433,"user":"dba_monitor","password":"..."}
#   ]
#
# Single quotes wrap the whole thing in docker-compose; use a secrets manager in prod.
############################################################################################################


############################################################################################################
# How a tool changes — before and after
#
# BEFORE (db.ts global pool):
#
#   server.tool("get_server_info", "...", {}, async () => {
#     const { rows } = await query("SELECT @@VERSION ...");
#     return ok(rows);
#   });
#
# AFTER (connectionManager, instance_name param):
#
#   server.tool("get_server_info", "...",
#     {
#       instance_name: z.string().optional().default("default")
#         .describe("Named SQL Server instance to query. Call list_instances to see available names.")
#     },
#     async ({ instance_name }) => {
#       const { rows } = await queryInstance(instance_name, "SELECT @@VERSION ...");
#       return ok(rows);
#     }
#   );
#
# The SQL inside every tool is unchanged — only the connection routing changes.
############################################################################################################


############################################################################################################
# The new list_instances tool — Copilot's entry point
#
#   server.tool(
#     "list_instances",
#     "List all configured SQL Server instances available for querying. " +
#     "Call this first if the user does not specify which instance they want.",
#     {},
#     async () => ok(listInstances())
#   );
#
# When you ask Copilot "check all my SQL Servers", it calls list_instances first,
# then fans out get_server_info / get_wait_stats across every returned name.
############################################################################################################


############################################################################################################
# docker-compose.yml — add the INSTANCES env var to sql-mcp-server
############################################################################################################

code docker-compose.yml

# Update the sql-mcp-server environment block:
#
#   sql-mcp-server:
#     build: ./sql-mcp-server
#     environment:
#       - INSTANCES=[
#           {"name":"SqlServer1","host":"sqlserver","port":1433,
#            "user":"dba_monitor","password":"MonitorP@ss123!"},
#           {"name":"SqlServer2","host":"sqlserver2","port":1433,
#            "user":"dba_monitor","password":"MonitorP@ss123!"}
#         ]
#     ports:
#       - "3001:3000"
#
# SQL_SERVER / SQL_USER / SQL_PASSWORD are no longer needed once INSTANCES is set,
# but they still work as the "default" fallback if INSTANCES is absent.


############################################################################################################
# mcp.json — unchanged
# One entry, one server, all instances accessible by name
############################################################################################################

code "$HOME/Library/Application Support/Code/User/mcp.json"

# {
#   "servers": {
#     "products-db": { "type": "http", "url": "http://localhost:5001/mcp" },
#     "sql-dba":     { "type": "http", "url": "http://localhost:3001/mcp" }
#   }
# }


############################################################################################################
# Ask Copilot to cross-instance queries once deployed:
#
#   What SQL Server instances do you have access to?
#   → calls list_instances
#
#   Compare wait stats on SqlServer1 vs prod. Which one has more CPU pressure?
#   → calls get_wait_stats(instance_name="SqlServer1")
#   → calls get_wait_stats(instance_name="prod")
#   → synthesizes comparison
#
#   Check all instances for blocking right now.
#   → fans out get_blocking_chains across every instance in parallel
############################################################################################################


############################################################################################################
# Migration path — 28 tools, same SQL, minimal churn
############################################################################################################

# 1. Add connectionManager.ts (done — see src/connectionManager.ts)
# 2. Add list_instances tool to tools.ts (5 lines)
# 3. For each of the 28 tools:
#      a. Add instance_name param (z.string().optional().default("default"))
#      b. Replace:  await query(sql, ...)
#         With:     await queryInstance(instance_name, sql, ...)
#    The SQL strings are untouched.
# 4. Update docker-compose INSTANCES env var
# 5. Rebuild: docker compose build sql-mcp-server && docker compose up -d sql-mcp-server
############################################################################################################


############################################################################################################
# fan_out_query — fleet-wide parallel execution
#
#    SEQUENTIAL CHAINING (agent loop):               FAN-OUT (single tool call):
#
#    list_instances()                                fan_out_query({
#      → ["SqlServer1", "SqlServer2"]                  query: "SELECT ...",
#                                                      instances: ["SqlServer1","SqlServer2"]
#    get_wait_stats("SqlServer1") ──► sqlserver        })
#    get_wait_stats("SqlServer2") → sqlserver2             ├─► sqlserver    ─┐
#                                                           └─► sqlserver2  ─┴─ parallel
#    Better for: interactive diagnosis               Better for: fleet-wide snapshot
#    (each result shapes the next question)          (one round-trip, N servers)
############################################################################################################


############################################################################################################
# fan_out_query tool — walk through the implementation
############################################################################################################

code sql-mcp-server/src/tools.ts

# Look for the fan_out_query tool (~50 lines after list_instances):
#
#   server.tool("fan_out_query", ...,
#     { query: z.string(), instances: z.array(z.string()).optional() },
#     async ({ query: sql, instances: subset }) => {
#       const targets = subset?.length ? listInstances().filter(...) : listInstances();
#       const settled = await Promise.allSettled(
#         targets.map(async (inst) => {
#           const { rows, truncated } = await queryInstance(inst.name, sql, 200);
#           return { instance: inst.name, rows, truncated };
#         })
#       );
#       // settled has per-instance results even if one instance is down
#       ...
#     }
#   );


############################################################################################################
# Test fan_out_query directly via MCP protocol
############################################################################################################

SESSION=$(curl -si -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-06-18","capabilities":{},
        "clientInfo":{"name":"demo","version":"1"}}}' \
  | grep -i "^mcp-session-id:" | awk '{print $2}' | tr -d '\r\n')

echo "Session: $SESSION"

curl -s -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION" \
  -d '{
    "jsonrpc":"2.0","id":2,"method":"tools/call",
    "params":{
      "name":"fan_out_query",
      "arguments":{
        "query":"SELECT @@SERVERNAME AS server_name, @@VERSION AS version"
      }
    }
  }'

# Both instances return their @@SERVERNAME in one call


############################################################################################################
# Copilot scenario — fleet-wide wait stats in one question
#
#   "Check for top waits across all SQL servers and summarize any concerns"
#
#   Copilot will either:
#   A. Call fan_out_query with a wait stats SELECT — one parallel round-trip
#   B. Call get_wait_stats(instance_name:"SqlServer1") then get_wait_stats(instance_name:"SqlServer2")
#
#   Either approach works. The agent chooses based on whether it wants
#   to use the pre-built tool logic or write the SQL itself.
############################################################################################################


############################################################################################################
# Fault tolerance demo — what happens when one instance is unreachable
#
#   fan_out_query uses Promise.allSettled, not Promise.all.
#   One instance being down returns an { error: "..." } for that key
#   while the others return { rows: [...] } normally.
#
#   Stop sqlserver2 and run fan_out_query to see partial results:
############################################################################################################

docker compose stop sqlserver2

# Then ask Copilot: "Run a fan-out query to get @@SERVERNAME from all instances"
# Expected: default returns rows, sqlserver2 returns { error: "connect ECONNREFUSED..." }

docker compose start sqlserver2
############################################################################################################
