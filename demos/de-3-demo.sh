#!/bin/bash
############################################################################################################
# DATA EXPOSED — SQL Server + GitHub Copilot via MCP
# Demo 3 of 4: sql-dba — Copilot as Your DBA (~6 minutes)
#
#   WHAT WE'LL COVER:
#     - Server health snapshot with a single natural-language prompt
#     - Injecting a blocking chain and asking Copilot to diagnose it
#     - Wait stats analysis across both SQL Server instances
#
#   MCP SERVER: sql-dba (http://localhost:3001/mcp)
#   KEY TOOLS:  get_server_info, get_active_sessions, get_blocking_chains,
#               get_wait_stats, get_top_queries, get_missing_indexes
############################################################################################################

# Load passwords from .env if not already set in environment
source .env

############################################################################################################
# SCENARIO 1 — Server health snapshot
#
#   Ask Copilot (Agent mode):
#
#     "Give me a health snapshot of SqlServer1. Cover version, uptime, configuration settings, and any obvious concerns."
#
#   Tools invoked: get_server_info, get_database_info
#   Watch for: MAXDOP=0, Cost Threshold for Parallelism=5,
#              max server memory uncapped, optimize for ad hoc workloads OFF
############################################################################################################


############################################################################################################
# SCENARIO 2 — Blocking chain investigation
#
# Step 1: Inject a blocking chain
# Run this in a SEPARATE terminal — it holds an X lock for 5 minutes then rolls back
############################################################################################################

docker exec -it sql-mcp-sqlserver1 /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P "${SA_PASSWORD}" -C \
    -d ProductsDB \
    -Q "BEGIN TRANSACTION;
        UPDATE dbo.Products SET UnitPrice = UnitPrice * 1.01 WHERE Category = 'Electronics';
        SELECT @@SPID AS [head_blocker_spid];
        WAITFOR DELAY '00:05:00';
        ROLLBACK TRANSACTION;"


############################################################################################################
# Step 2: Start a blocked reader in another terminal
############################################################################################################

source .env

docker exec -it sql-mcp-sqlserver1 /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P "${SA_PASSWORD}" -C \
    -d ProductsDB \
    -Q "SELECT ProductID, ProductName, UnitPrice FROM dbo.Products WHERE Category = 'Electronics';"


############################################################################################################
# Step 3: Ask Copilot to diagnose the blocking
#
#   "Are there any blocked sessions on SqlServer1 right now? Who is blocking whom, how long has it been waiting, and what SQL is running?"
#
#   Tools invoked: get_blocking_chains, get_active_sessions
#   Watch for:
#     - head blocker: SPID with UPDATE + WAITFOR
#     - victim: SPID waiting on LCK_M_S
#     - wait_time_ms growing each time Copilot calls the tool
############################################################################################################


############################################################################################################
# Step 4: Clean up — kill the head blocker
# Replace <spid> with the SPID Copilot identified as the head blocker
############################################################################################################

source .env

docker exec -it sql-mcp-sqlserver1 /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P "${SA_PASSWORD}" -C \
    -Q "KILL 52"


############################################################################################################
# SCENARIO 3 — Wait stats across both instances
#
#   Ask Copilot:
#
#     "Check wait stats on both SqlServer1 and SqlServer2. Summarize what each server is waiting on and flag anything concerning."
#
#   Tools invoked: list_instances,
#                  get_wait_stats(instance_name:"SqlServer1"),
#                  get_wait_stats(instance_name:"SqlServer2")
#   Watch for:
#     - Copilot making 3 sequential tool calls in one agent turn
#     - Startup waits (STARTUP_DEPENDENCY_MANAGER, PWAIT_ALL_COMPONENTS_INITIALIZED)
#       dominating a freshly started server — expected, not actionable
#     - SOS_SCHEDULER_YIELD = CPU pressure, PAGEIOLATCH_* = I/O pressure (neither expected here)
############################################################################################################

