#!/bin/bash
############################################################################################################
# 5. One MCP Server, Many SQL Server Instances
#    The connectionManager.ts architecture — lazy pools, per-instance routing, fleet-wide operations.
#
#    ARCHITECTURE:
#
#      mcp.json              sql-mcp-server (port 3001)          SQL Servers
#      ────────────────      ──────────────────────────────       ───────────────────
#                            connectionManager.ts
#      sql-dba               ┌────────────┬────────────┐
#       :3001/mcp ─────────► │ "SqlServer1" │ "SqlServer2"│
#                            │    pool    │    pool    │
#                            │  (max 5)   │  (max 5)   │
#                            └─────┬──────┴──────┬─────┘
#                                  │             │
#                                  ▼             ▼
#                            sqlserver:1433  sqlserver2:1433
#
#    One MCP entry in mcp.json. Both instances reachable via instance_name parameter.
#    Zero code changes to add a new instance — just edit .env.
############################################################################################################


############################################################################################################
# Step 1 — Confirm both SQL Server instances are running
############################################################################################################

docker compose ps

# Both sqlserver (port 1433) and sqlserver2 (port 1434) should be healthy.
# sqlserver2 was added to docker-compose.yml — no separate docker run needed.


############################################################################################################
# Step 2 — Inspect the instance configuration
# INSTANCES is a JSON array in .env, loaded via env_file in docker-compose.yml
############################################################################################################

grep -A 20 'INSTANCES=' .env


############################################################################################################
# Step 3 — Confirm sql-mcp-server registered both instances at startup
############################################################################################################

docker logs sql-mcp-dba | grep "Registered instances"

# Expected: [db] Registered instances: SqlServer1, SqlServer2


############################################################################################################
# Step 4 — Walk through connectionManager.ts
# lazy pool creation, per-instance routing, error recovery
############################################################################################################

code sql-mcp-server/src/connectionManager.ts


############################################################################################################
# Step 5 — The instance_name parameter in every tool
# instanceParam is a shared spread constant — one line adds it to all 30 tools
############################################################################################################

code sql-mcp-server/src/tools.ts

# Look for:
#   const instanceParam = { instance_name: z.string().optional().default("default")... }
#
# Every tool schema is:
#   { ...instanceParam, <other params> }
#
# Every async callback destructures it:
#   async ({ instance_name, <other params> }) => {
#     const { rows } = await queryInstance(instance_name, sql);


############################################################################################################
# Step 6 — Copilot scenarios
#
#   SCENARIO A: Target a specific instance
#
#     "Get server info for SqlServer2"
#
#   Tools invoked: list_instances (optional), get_server_info(instance_name:"SqlServer2")
#   Watch for: server_name = "sqlserver2", different uptime from SqlServer1
#
############################################################################################################

# SCENARIO B: Compare two instances
#
#   "Check wait stats on both SQL Server instances and tell me if there are any concerns"
#
#   Tools invoked:
#     1. list_instances() → ["SqlServer1", "SqlServer2"]
#     2. get_wait_stats(instance_name:"SqlServer1")
#     3. get_wait_stats(instance_name:"SqlServer2")
#   Copilot will compare both and synthesize a diagnosis.


############################################################################################################
# Step 7 — Under the hood: what happens on the first call to SqlServer2
# Before:  pools Map = { "SqlServer1": <connected pool> }
# Request: get_server_info(instance_name: "SqlServer2")
#  → getPool("SqlServer2")
#  → pools.get("SqlServer2") is undefined
#  → new ConnectionPool({ host: "sqlserver2", port: 1433, user: "sa", ... }).connect()
#  → TCP connect → TDS handshake → SQL login → pool ready
#  → pools.set("SqlServer2", pool)
#  → pool.request().query(sql)
# After: pools Map = { "SqlServer1": <pool>, "SqlServer2": <pool> }
############################################################################################################

docker logs sql-mcp-dba | grep "Connected to instance"

# Shows lazy connection log lines as each instance is first queried


############################################################################################################
# PRODUCTION PATTERN — adding a third instance (zero code changes)
#
#  1. Add an entry to the INSTANCES array in .env:
#       INSTANCES=[
#         {"name":"SqlServer1", "host":"sqlserver",       ...},
#         {"name":"SqlServer2", "host":"sqlserver2",      ...},
#         {"name":"prod",     "host":"prod-sql01.corp",  "port":1433, "user":"dba_monitor", "password":"..."}
#       ]
#
#  2. Restart the container:
#       docker compose restart sql-mcp-server
#
#  3. Copilot immediately sees the new instance:
#       "List instances"  →  ["SqlServer1", "SqlServer2", "prod"]
#
#  No mcp.json changes. No Dockerfile changes. No TypeScript changes.
############################################################################################################
