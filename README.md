# SQL Server MCP Demo

I've been thinking a lot lately about what it actually takes to make an AI agent useful for database work. Writing T-SQL is the easy part a coding assistant can do that out of the box. The hard part is giving it *visibility* into a running SQL Server: which sessions are blocked right now, where the wait stats are pointing, which indexes the optimizer is begging for. Without that, the agent is just guessing.

I built this demo to show two complementary ways to wire SQL Server into a GitHub Copilot agent using MCP on SQL Server 2025. Both run in Docker Compose with no local installs beyond Docker Desktop.

- **Data API Builder (DAB)** — zero-code MCP server. Point it at a database and it exposes REST, GraphQL, and MCP endpoints automatically. It's the right tool when you want natural-language CRUD over a known application schema. DAB's MCP support works great for user databases, but I tried to expose system DMVs through DAB and ran into a wall  unsupported data types and query patterns in the system DMV/DMFs meant that approach broke down quickly. That's what pushed me toward the custom server.
- **Custom SQL MCP Server** — a TypeScript MCP server with 30 hand-crafted tools that query SQL Server DMVs directly. Built for DBA-style diagnostics: blocking chains, wait stats, missing indexes, query plan cache, memory pressure, and more. A single container manages connections to multiple SQL Server instances. Add a new server to a JSON array in `.env`, restart the container, and the agent can reach it immediately.

The agent never touches the database directly. It calls your tool server. Your tool server runs the SQL. You stay in control.

Let's go.

## Quick Start

```bash
# 1. Clone and copy the env file
git clone https://github.com/nocentino/sql-mcp-server.git
cd sql-mcp-server
cp .env.example .env          # set your passwords in .env

# 2. Start everything
docker compose up --build -d  # first run: ~2-3 min to pull + seed the DB

# 3. Verify
docker compose ps
curl http://localhost:3001/health   # SQL MCP server
curl http://localhost:5001/health   # DAB

# 4. Wire up VS Code add to ~/Library/Application Support/Code/User/mcp.json
{
  "servers": {
    "sql-dba":     { "type": "http", "url": "http://localhost:3001/mcp" },
    "products-db": { "type": "http", "url": "http://localhost:5001/mcp" }
  }
}

# 5. Open Copilot Chat in agent mode and ask:
#    "Tell me about this SQL Server version, uptime, and any config concerns."
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Docker Network                               │
│                                                                      │
│  ┌───────────────┐   CRUD   ┌──────────────────────────────────┐     │
│  │               │◄─────────│  DAB MCP  (dab-mcp :5001)        │     │
│  │  sqlserver    │          │  REST / GraphQL / MCP            │     │
│  │  - ProductsDB │          └──────────────────────────────────┘     │
│  │  Port 1433    │                                                   │
│  │               │  SELECT  ┌──────────────────────────────────┐     │
│  │               │◄────┐    │  SQL MCP Server  (sql-mcp-dba    │     │
│  └───────────────┘     └────│  :3001)  connectionManager.ts    │     │
│                         ┌───│                                  │     │
│  ┌───────────────┐      │   └──────────────────────────────────┘     │
│  │  sqlserver2   │◄─────┘                                            │
│  │  Port 1433    │  SELECT (second instance)                         │
│  └───────────────┘                                                   │
└──────────────────────────────────────────────────────────────────────┘
```

| Service | Purpose | Host port |
|---|---|---|
| `sqlserver` | SQL Server 2025 — ProductsDB + monitoring | 1433 |
| `sqlserver2` | SQL Server 2025 — second instance for testing | 1434 |
| `dab-mcp` | DAB — ProductsDB CRUD via MCP | 5001 |
| `sql-mcp-server` | Custom MCP — DBA monitoring (multi-instance) | 3001 |

## Connect AI Agents

### VS Code / GitHub Copilot

Once the containers are running, register both servers in your VS Code MCP config at `~/Library/Application Support/Code/User/mcp.json`:

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

## What This Looks Like in Practice

This is where it gets interesting. The agent doesn't just run a single query it chains tool calls, cross-references the results, and synthesizes a diagnosis, all from one natural-language question. Here are some examples straight from the demo scripts.

---

### Blocking investigation

> **You:** "Are there any blocking sessions right now? Who is blocking whom, how long has the block been in place, and what SQL is running?"

```
Agent → get_blocking_chains(instance_name: "SqlServer1")
      ← blocking_chains: [
          {
            blocked_session_id: 54,
            blocking_session_id: 52,
            wait_type: "LCK_M_S",
            wait_seconds: 14.3,
            blocked_login: "sa",
            blocked_program: "SQLCMD",
            blocked_statement: "SELECT ProductID, ProductName, UnitPrice
                                FROM dbo.Products WHERE Category = 'Electronics'",
            blocker_login: "sa",
            blocker_program: "SQLCMD",
            blocker_sql_text: "BEGIN TRANSACTION;
                               UPDATE dbo.Products SET UnitPrice = UnitPrice * 1.01
                               WHERE Category = 'Electronics';
                               WAITFOR DELAY '00:05:00';"
          },
          {
            blocked_session_id: 57,
            blocking_session_id: 52,
            wait_type: "LCK_M_S",
            wait_seconds: 11.8,
            blocked_program: "dab_oss_2.0.1",
            blocked_statement: "SELECT [ProductID],[ProductName],[UnitPrice]...
                                FROM [dbo].[Products] WHERE Category = 'Electronics'"
          }
        ]

Agent: "Session 52 is the head blocker. It opened a transaction, ran an UPDATE on
        all Electronics rows, then entered a WAITFOR — holding an exclusive lock for
        over 14 seconds. Two sessions are queued behind it: a SQLCMD SELECT and a
        DAB REST request (dab_oss_2.0.1). Kill session 52 with KILL 52 to unblock
        both, or wait for the WAITFOR to expire and the transaction to roll back."
```

---

### Missing index recommendations

> **You:** "Are there any missing index recommendations? Show me the indexes with the highest impact score, what columns they cover, and give me the CREATE INDEX statements I can run."

```
Agent → get_missing_indexes(instance_name: "SqlServer1")
      ← missing_indexes: [
          {
            database_name: "ProductsDB",
            table_name: "dbo.Products",
            impact_score: 98.4,
            equality_columns: "Discontinued",
            inequality_columns: null,
            included_columns: "Category, UnitPrice",
            estimated_seeks: 150,
            estimated_scans: 2,
            suggested_create_index:
              "CREATE INDEX [IX_Products_Discontinued_INC]
               ON [dbo].[Products] ([Discontinued])
               INCLUDE ([Category],[UnitPrice])"
          },
          {
            table_name: "dbo.Products",
            impact_score: 84.1,
            equality_columns: null,
            inequality_columns: "UnitsInStock, UnitPrice",
            included_columns: "ProductName",
            suggested_create_index:
              "CREATE INDEX [IX_Products_UnitsInStock_UnitPrice_INC]
               ON [dbo].[Products] ([UnitsInStock],[UnitPrice])
               INCLUDE ([ProductName])"
          }
        ]

Agent → get_index_usage_stats(instance_name: "SqlServer1")
      ← confirms both indexes have zero existing seeks — no covering index in place

Agent: "Two high-impact indexes are missing on dbo.Products. The top one
        (impact 98.4) covers the Discontinued filter used in category summary
        queries. The second (impact 84.1) covers the UnitsInStock + UnitPrice
        range scan seen in the low-stock report. Both CREATE INDEX statements
        are ready to run — test in a non-prod environment first."
```

---

### Low-stock check + summer sale discount (DAB)

> **You:** "Show me all products with fewer than 50 units in stock, sorted by stock level. Which categories are most at risk of running out?"

```
Agent → products-db: read_records(entity: "Products",
          filter: "UnitsInStock lt 50", orderby: "UnitsInStock asc")
      ← [
          { ProductName: "Standing Desk",  Category: "Furniture",    UnitsInStock: 15 },
          { ProductName: "Bookshelf",      Category: "Furniture",    UnitsInStock: 20 },
          { ProductName: "Air Purifier",   Category: "Electronics",  UnitsInStock: 25 },
          { ProductName: "Office Chair",   Category: "Furniture",    UnitsInStock: 30 }
        ]

Agent: "Furniture is the most at-risk category — 3 of the 4 low-stock products
        are Furniture. Standing Desk is critically low at 15 units."
```

> **You:** "We're running a summer sale. Apply a 15% discount to all Furniture products. Show me the before and after prices."

```
Agent → products-db: read_records(entity: "Products", filter: "Category eq 'Furniture'")
      ← [Standing Desk $599.99, Bookshelf $149.99, Office Chair $299.99, ...]

Agent → products-db: update_record(entity: "Products", id: 3,  body: { UnitPrice: 509.99 })
Agent → products-db: update_record(entity: "Products", id: 8,  body: { UnitPrice: 127.49 })
Agent → products-db: update_record(entity: "Products", id: 12, body: { UnitPrice: 254.99 })

Agent: "15% discount applied to all Furniture products:
        - Standing Desk:  $599.99 → $509.99
        - Bookshelf:      $149.99 → $127.49
        - Office Chair:   $299.99 → $254.99"
```

---

### Multi-instance wait stats comparison

> **You:** "Check wait stats on both SQL Server instances and tell me if there are any concerns."

```
Agent → list_instances()
      ← [
          { name: "SqlServer1", host: "sqlserver",  port: 1433 },
          { name: "SqlServer2", host: "sqlserver2", port: 1433 }
        ]

Agent → get_wait_stats(instance_name: "SqlServer1")   [parallel]
Agent → get_wait_stats(instance_name: "SqlServer2")   [parallel]
      ← SqlServer1 top waits:
          PAGEIOLATCH_SH  42 %   ← disk read pressure
          SOS_SCHEDULER_YIELD  18 %   ← CPU pressure
          LCK_M_S  11 %
        SqlServer2 top waits:
          ASYNC_NETWORK_IO  61 %   ← client consuming results slowly
          PAGEIOLATCH_SH  14 %

Agent: "SqlServer1 shows significant disk read pressure (PAGEIOLATCH_SH 42%) and
        CPU contention (SOS_SCHEDULER_YIELD 18%) — worth checking get_file_io_stats
        and get_top_queries. SqlServer2's dominant wait is ASYNC_NETWORK_IO, which
        usually means a client is not consuming result sets fast enough; check for
        large unbounded SELECTs or a slow application tier."
```

---

### Full incident report

> **You:** "Pull a full health snapshot of this SQL Server: server info, databases, wait stats, top queries by CPU, any blocking, and missing indexes. Write it up as an incident report I could hand to a DBA."

```
Agent → get_server_info(instance_name: "SqlServer1")
      ← SQL Server 2025 Developer, 4 CPUs, 8192 MB RAM, uptime 2d 6h
         MAXDOP=0 ⚠, cost threshold for parallelism=5 ⚠,
         max server memory=2147483647 (uncapped) ⚠,
         optimize for ad hoc workloads=0 ⚠

Agent → get_database_info(instance_name: "SqlServer1")
      ← ProductsDB: FULL recovery, 48 MB data, 8 MB log, log_reuse_wait=LOG_BACKUP

Agent → get_wait_stats(instance_name: "SqlServer1")
      ← PAGEIOLATCH_SH 38%, SOS_SCHEDULER_YIELD 19%, LCK_M_S 9%

Agent → get_top_queries(instance_name: "SqlServer1", order_by: "cpu", top_n: 5)
      ← #1: Products × OrderDetails × Orders join, avg_cpu_ms=312, 50 execs,
             avg_logical_reads=8420 — no covering index on Products.Category

Agent → get_blocking_chains(instance_name: "SqlServer1")
      ← No blocking detected at this time.

Agent → get_missing_indexes(instance_name: "SqlServer1")
      ← 2 missing indexes (impact 98.4, 84.1) on dbo.Products

Agent: "## SQL Server Health Report — SqlServer1
        ...
        Configuration concerns: MAXDOP is 0 (unlimited parallelism), cost threshold
        for parallelism is 5 (too low — triggers parallelism too aggressively), max
        server memory is uncapped. Recommend setting MAXDOP=2, CTFP=50, and capping
        server memory to ~6 GB.

        Top CPU query (avg 312 ms, 50 execs): the three-way join on Products ×
        OrderDetails × Orders is scanning 8 420 pages per execution. Adding the
        missing index on Products (Discontinued) INCLUDE (Category, UnitPrice)
        would cover this query path.

        No active blocking. ProductsDB log is waiting on LOG_BACKUP — ensure the
        log backup job is running on schedule."
```

## Multi-Instance Architecture

One of the things I'm most happy with in this design is how the multi-instance support works. A single `sql-mcp-server` container manages connection pools to as many SQL Server instances as you need. Instances are registered at startup via the `INSTANCES` environment variable in `.env`.

### Instance configuration (`.env`)

```
INSTANCES=[
  {"name":"default",    "host":"sqlserver",  "port":1433, "user":"dba_monitor", "password":"..."},
  {"name":"sqlserver2", "host":"sqlserver2", "port":1433, "user":"sa",          "password":"..."}
]
```

Add or remove instances by editing this file and restarting the container. No code changes required.

### Connection flow

```
Copilot → MCP tool call (instance_name: "sqlserver2")
           │
           ▼
     queryInstance("sqlserver2", sql)
           │
           ├─ pools.get("sqlserver2").connected?  →  reuse (fast path)
           │
           └─ first call → new ConnectionPool({ host: "sqlserver2", ... }).connect()
                           → TCP to sqlserver2:1433 over Docker bridge
                           → TDS handshake + SQL Server login
                           → pool stored in module-level Map
           │
           ▼
     pool.request().query(sql)   ← borrows one connection from the pool
           │
           ▼
     rows returned to Copilot
```

### Concurrency model

Each instance gets its own `ConnectionPool`. Here's how the settings are tuned:

| Setting | Value | Effect |
|---|---|---|
| `max` | 5 | Up to 5 simultaneous TDS connections per instance |
| `min` | 0 | No warm connections held — pools start empty |
| `idleTimeout` | 30 s | Idle connections closed and evicted automatically |
| Pools are lazy | — | First tool call to an instance opens the pool |
| Pools are shared | — | All MCP sessions reuse the same per-instance pool |
| Error recovery | — | Pool errors evict the pool; next request reconnects automatically |

### Fan-out across the fleet

The `fan_out_query` tool runs the same T-SQL across all instances (or a named subset) in parallel using `Promise.allSettled`. One instance being down doesn't cancel queries on the others.

```
Copilot: "check wait stats across all SQL servers"

1. list_instances()  →  ["default", "sqlserver2"]

2. fan_out_query({ query: "SELECT ...", instances: ["default", "sqlserver2"] })

   Promise.allSettled([
     queryInstance("default",    sql)  ──► sqlserver:1433   ─┐
     queryInstance("sqlserver2", sql)  ──► sqlserver2:1433  ─┤  parallel
   ])                                                          ↓
   returns: {
     "default":    { rows: [...] },
     "sqlserver2": { rows: [...] }
   }

3. Copilot synthesizes across both result sets
```

Sequential chaining (`get_wait_stats(instance_name: "X")` per instance) is better for interactive investigation where each result shapes the next question. `fan_out_query` is better when you want a fleet-wide snapshot in a single round-trip.

## REST and GraphQL (DAB)

DAB also exposes a standard REST and GraphQL endpoint if you want to hit the API directly outside of the agent.

```bash
# Products list
curl http://localhost:5001/api/Products

# GraphQL
curl -X POST http://localhost:5001/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ products(first:5) { items { ProductID ProductName UnitPrice } } }"}'
```

## Direct SQL access

If you want to poke at the database directly during testing:

```bash
docker compose exec sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P 'S0methingS@Str0ng!' -C -d ProductsDB \
  -Q "SELECT TOP 5 ProductName, UnitPrice FROM Products"
```

## Stop

```bash
docker compose down       # stop, keep data
docker compose down -v    # stop and delete all data
```

## Project layout

```
├── docker-compose.yml           # service orchestration (sqlserver, sqlserver2, dab-mcp, sql-mcp-server)
├── .env                         # SQL Server passwords, INSTANCES config
├── dab-config.json              # DAB entity config for ProductsDB
├── start.sh / stop.sh / setup.sh
├── sql-mcp-server/
│   ├── src/
│   │   ├── index.ts             # Streamable HTTP transport, MCP session management
│   │   ├── tools.ts             # 30 tools (list_instances, fan_out_query + 28 DBA tools)
│   │   ├── connectionManager.ts # Multi-instance pool manager lazy, per-instance, self-healing
│   │   └── safety.ts            # Query allowlist (SELECT / WITH / DECLARE only)
│   ├── Dockerfile
│   └── package.json
├── demos/                       # walkthrough demo scripts (1–5)
├── scripts/
│   ├── init-sqlserver1.sql      # ProductsDB schema, sample data, dba_monitor + dab_app logins
├── tests/
│   ├── integration.sh           # endpoint integration tests
│   ├── smoke.sh                 # T-SQL smoke tests against dba_monitor
│   ├── tools.sh                 # MCP tool integration tests (via mcp-integration.mjs)
│   └── mcp-integration.mjs      # raw MCP protocol test harness
└── docs/
    ├── QUICKSTART.md
    └── MCP-CLIENT-EXAMPLES.md   # mcp.json config for VS Code, Claude Desktop, etc.
```

## SQL MCP Server Tools

Here's the full list of tools available in the `sql-dba` server. Call `list_instances` first if you haven't specified which server you want to target.

### Instance Management
| Tool | Description |
|---|---|
| `list_instances` | List all registered SQL Server instances — call first when no instance is specified |
| `fan_out_query` | Run any T-SQL on all (or a subset of) instances in parallel; results keyed by instance name |

### General Query & Session Monitoring
| Tool | Description |
|---|---|
| `execute_query` | Run any read-only T-SQL (SELECT / WITH / DECLARE) against a named instance |
| `get_active_sessions` | Sessions + current SQL text via CROSS APPLY |
| `get_blocking_chains` | Full blocking chain with blocker and blocked SQL |

### Query Performance & Plan Analysis
| Tool | Description |
|---|---|
| `get_top_queries` | Plan cache ranked by CPU, reads, elapsed, memory, or executions |
| `get_query_store_regressions` | Queries with plan regressions (Query Store) — forced plans, perf degradation |
| `get_plan_cache_pollution` | Single-use plans wasting memory + parameter sniffing candidates |

### Wait Statistics & Contention
| Tool | Description |
|---|---|
| `get_wait_stats` | Cumulative waits since restart (benign waits filtered by default) |
| `get_latch_stats` | Latch waits by class (PAGEIOLATCH vs PAGELATCH) |
| `get_long_running_transactions` | Open transactions > N seconds with log space + lock count |
| `get_deadlock_history` | Recent deadlocks from system_health XE ring buffer |

### I/O, CPU & Memory
| Tool | Description |
|---|---|
| `get_file_io_stats` | Read/write latency per file + volume free space |
| `get_cpu_history` | Ring buffer CPU history (~256 minutes) |
| `get_memory_usage` | Memory clerks + system RAM + grant semaphore status |
| `get_buffer_pool_by_object` | Which tables/indexes are cached in RAM |
| `get_perfmon_counters` | Windows PerfMon counters (batch requests/sec, page life expectancy, etc.) |

### TempDB & Storage
| Tool | Description |
|---|---|
| `get_tempdb_usage` | TempDB space by file and by session |
| `get_database_info` | All databases with size, recovery model, log reuse wait |
| `get_database_files` | Detailed file info: size, growth settings, space used |
| `get_vlf_count` | Virtual Log File count per database (high VLF = slow recovery) |

### Index & Statistics Health
| Tool | Description |
|---|---|
| `get_missing_indexes` | Optimizer recommendations with ready-to-use CREATE INDEX DDL |
| `get_index_usage_stats` | Seeks/scans/updates per index — identifies unused indexes |
| `get_index_fragmentation` | Fragmentation + page density per index (rebuild vs reorganize) |
| `get_statistics_health` | Stale statistics — high rowmodctr since last update |
| `get_columnstore_health` | Columnstore rowgroup states, delta store bloat |

### Availability & Operational
| Tool | Description |
|---|---|
| `get_server_info` | Version, edition, CPU/RAM, uptime, key sp_configure values |
| `get_ag_health` | Always On AG replica sync state, send/redo queue |
| `get_backup_status` | Last full/diff/log backup per database |
| `get_job_status` | SQL Agent job status: last run, currently executing, failed jobs |

## DAB entities (ProductsDB)

| Entity | Table | Operations |
|---|---|---|
| Products | dbo.Products | CRUD |
| Categories | dbo.Categories | CRUD |
| Orders | dbo.Orders | CRUD |
| OrderDetails | dbo.OrderDetails | CRUD |

## Wrapping Up

Clone the repo, spin up the containers, and ask Copilot to pull a health snapshot of your SQL Server. The 30 DMV-backed tools give it enough visibility to diagnose blocking, identify expensive queries, spot missing indexes, and flag configuration concerns all from a single natural-language question. Get out in your lab and start testing.

The code is at [github.com/nocentino/sql-mcp-server](https://github.com/nocentino/sql-mcp-server). Let me know how it works in your environment.

## Notes

- **`dba_monitor` permissions** — created with `VIEW SERVER STATE` only. No stored procedures or views on the monitored server. All T-SQL lives inside the MCP server's tool definitions.
- **Adding a new instance** — add an entry to the `INSTANCES` array in `.env` and restart `sql-mcp-server`. No code changes needed.
- **SA password** — the default is `S0methingS@Str0ng!`. Change it in `.env` before use.
- **Regenerating `dab-config.json`** — if you change the schema, run `./scripts/generate-dab-config.sh`.

## Acknowledgements

Several DMV queries in `sql-mcp-server/src/tools.ts` are derived from the **[Brent Ozar First Responder Kit](https://github.com/BrentOzarULTD/SQL-Server-First-Responder-Kit)** specifically the ignorable wait type list in `get_wait_stats` and the blocker SQL lookup via `dm_exec_connections.most_recent_sql_handle` in `get_blocking_chains`. The First Responder Kit is released under the **MIT License**.
