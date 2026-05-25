#!/bin/bash
############################################################################################################
# 4. Copilot as Your DBA — Live Diagnostics Against SQL Server 2025
#    Each scenario starts with a natural-language question in Copilot Chat
#    and ends with an AI-generated diagnosis backed by real DMV data.
#    MCP server used: sql-dba (http://127.0.0.1:3001/mcp)
############################################################################################################


############################################################################################################
# SCENARIO 1 — First Look: What server am I connected to?
############################################################################################################

# In Copilot Chat, ask:
#
#   Tell me about this SQL Server instance. What version is it, how long has it
#   been running, and are there any obvious configuration concerns?
#
# Tools invoked: get_server_info
# Watch for: MAXDOP=0, CTFP=5, max server memory uncapped, optimize for ad hoc workloads OFF
############################################################################################################


############################################################################################################
# SCENARIO 2 — Blocking Investigation
# Inject a three-session blocking chain: SQLCMD → SQLCMD → DAB REST API
############################################################################################################

# Terminal 1 — Connection A: holds an exclusive lock for 5 minutes, then rolls back
docker exec sql-mcp-sqlserver1 /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P 'S0methingS@Str0ng!' -C \
    -d ProductsDB \
    -Q "BEGIN TRANSACTION;
        UPDATE dbo.Products SET UnitPrice = UnitPrice * 1.01 WHERE Category = 'Electronics';
        SELECT @@SPID AS blocker_spid;
        WAITFOR DELAY '00:05:00';
        ROLLBACK TRANSACTION;"


############################################################################################################
# Terminal 2 — Connection B: raw SQL SELECT blocked by A's X lock
############################################################################################################

docker exec -it sql-mcp-sqlserver1 /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P 'S0methingS@Str0ng!' -C \
    -d ProductsDB \
    -Q "SELECT ProductID, ProductName, UnitPrice FROM dbo.Products WHERE Category = 'Electronics';"


############################################################################################################
# Terminal 3 — Connection C: REST API call blocked by the same X lock
# DAB translates this HTTP GET into a SQL SELECT, which queues behind A.
############################################################################################################

curl -s "http://localhost:5001/api/Products?\$filter=Category%20eq%20'Electronics'" | jq .


############################################################################################################
# Now ask Copilot:
#
#   Are there any blocking sessions right now? Who is blocking whom, how long
#   has the block been in place, and what SQL is running?
#
# Tools invoked: get_blocking_chains, get_active_sessions
# Watch for: three-session chain — head blocker (UPDATE + WAITFOR), SQLCMD victim,
#            and dab_oss_2.0.1 victim all waiting on LCK_M_S
############################################################################################################


############################################################################################################
# Clean up — kill the head blocker (SPID reported by connection A above)
############################################################################################################

docker exec sql-mcp-sqlserver1 /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P 'S0methingS@Str0ng!' -C \
    -Q "KILL <spid_from_blocking_chain>"


############################################################################################################
# SCENARIO 3 — Wait Stats and Performance Fingerprinting
############################################################################################################

# Ask Copilot:
#
#   Look at the wait statistics and tell me where this SQL Server is spending
#   its time. Is there any I/O pressure, CPU pressure, or memory contention?
#   Give me a ranked summary and tell me what each top wait type means.
#
# Tools invoked: get_wait_stats, get_file_io_stats, get_cpu_history, get_memory_usage
############################################################################################################


############################################################################################################
# Generate I/O and CPU load so the wait stats show something interesting
############################################################################################################

docker exec sql-mcp-sqlserver1 /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P 'S0methingS@Str0ng!' -C \
    -d ProductsDB \
    -Q "DECLARE @i INT = 0;
        WHILE @i < 50
        BEGIN
            SELECT p.ProductName, p.UnitPrice, od.Quantity, p.Category
            FROM   dbo.Products p
            JOIN   dbo.OrderDetails od ON od.ProductID = p.ProductID
            JOIN   dbo.Orders o        ON o.OrderID    = od.OrderID
            WHERE  p.UnitPrice > RAND() * 100;
            SET @i = @i + 1;
        END"


############################################################################################################
# After the workload finishes, ask Copilot:
#
#   What are the top 5 most expensive queries since the server restarted?
#   Rank by CPU. Show me the query text and tell me if any look like
#   parameter sniffing candidates.
#
# Tools invoked: get_top_queries, get_plan_cache_pollution
############################################################################################################


############################################################################################################
# SCENARIO 4 — Missing Index Recommendations
############################################################################################################

# Generate table scans to populate the missing index DMVs
docker exec sql-mcp-sqlserver1 /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P 'S0methingS@Str0ng!' -C \
    -d ProductsDB \
    -Q "SELECT p.ProductName, p.UnitPrice, p.UnitsInStock
        FROM   dbo.Products p
        WHERE  p.UnitsInStock < 30
        AND    p.UnitPrice > 50
        ORDER  BY p.UnitsInStock ASC;

        SELECT p.Category, COUNT(p.ProductID) AS ProductCount, AVG(p.UnitPrice) AS AvgPrice
        FROM   dbo.Products p
        WHERE  p.Discontinued = 0
        GROUP  BY p.Category;"


############################################################################################################
# Ask Copilot:
#
#   Are there any missing index recommendations? Show me the indexes with the
#   highest impact score, what columns they cover, and give me the CREATE INDEX
#   statements I can run.
#
# Tools invoked: get_missing_indexes, get_index_usage_stats
# Watch for: impact_score, ready-to-use CREATE INDEX in suggested_create_index
############################################################################################################


############################################################################################################
# BONUS — Full incident report
############################################################################################################

# Ask Copilot:
#
#   Pull a full health snapshot of this SQL Server: server info, databases,
#   wait stats, top queries by CPU, any blocking, and missing indexes.
#   Write it up as an incident report I could hand to a DBA.
#
# Tools invoked: get_server_info, get_database_info, get_wait_stats,
#                get_top_queries, get_blocking_chains, get_missing_indexes
# Watch for: Copilot chaining multiple tool calls in a single agent turn
############################################################################################################
