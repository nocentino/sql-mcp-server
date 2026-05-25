# **SQL Server Multi-Instance Environment Health Report**
## **Under Active Workload with Blocking Scenario**
### Generated: May 25, 2026 13:32 UTC | Environment: sql-mcp Demo

---

## **Executive Summary**

**Environment:** 2 SQL Server instances detected  
**Primary Instance (SqlServer1):** ⚠️ **ACTIVE WORKLOAD** - Blocking detected!  
**Secondary Instance (SqlServer2):** ✅ **HEALTHY** (no workload)  
**Critical Issues:** 🔴 **1** - Active blocking chains (2 blocked sessions)  
**Warnings:** 4 (Configuration tuning recommended, No backups configured)  
**High Availability:** ⚠️ **PARTIALLY CONFIGURED** - AG setup script ran but verification failed

---

## **🔴 CRITICAL ALERT: Active Blocking**

### **Blocking Chain Detected**

**⚠️ IMMEDIATE ACTION REQUIRED:** 2 sessions are currently blocked by session 51

| Blocked Session | Wait Type | Wait Time | Command | Statement | Blocking Session |
|-----------------|-----------|-----------|---------|-----------|------------------|
| **52** | LCK_M_X (Exclusive Lock) | **32 seconds** | UPDATE | `UPDATE [TestData] SET [TestValue] = @1 WHERE [ID]>=@2 AND [ID]<=@3` | 51 |
| **55** | LCK_M_S (Shared Lock) | **24 seconds** | SELECT | `SELECT TOP 1000 * FROM TestData WHERE ID > @i * 1000 ORDER BY CreatedAt` | 51 |

**Blocker Details (Session 51):**
- **Login:** sa
- **Program:** SQLCMD
- **Database:** TestDB
- **SQL Text:** Long-running transaction with WAITFOR DELAY (intentional for demo)
```sql
USE TestDB;
BEGIN TRANSACTION;
UPDATE TestData SET TestValue = 'LOCKED' WHERE ID BETWEEN 1000 AND 2000;
WAITFOR DELAY '00:02:00';
ROLLBACK;
```
- **Started:** 2026-05-25T13:31:17.030Z
- **Impact:** Holding locks on 1,001 rows, blocking both UPDATE and SELECT operations

**Resolution:** In a production environment, consider killing session 51 if this is not an expected long-running transaction.

---

## **Environment Overview**

### **Instance Discovery**

| Instance Name | Host | Port | User | Status |
|--------------|------|------|------|--------|
| **SqlServer1** | sqlserver1 | 1433 | dba_monitor | ⚠️ **ACTIVE - BLOCKING** |
| **SqlServer2** | sqlserver2 | 1433 | dba_monitor | ✅ **ACCESSIBLE** |

**Finding:** SqlServer1 is experiencing a blocking scenario with active workload. TestDB contains 100,005 rows of data after batch inserts. SqlServer2 is idle with no blocking.

---

## **Instance 1: SqlServer1 (Primary - Active Workload)**

### **1. Infrastructure Overview**

#### **Server Configuration**
| Property | Value |
|----------|-------|
| **SQL Server Version** | 2025 Enterprise Developer (17.0.4005.7) RTM |
| **Server Name** | sqlserver1 |
| **HADR Enabled** | ✅ Yes (pre-configured for AG) |
| **Clustered** | ❌ No (cluster-less capable) |
| **CPU Count** | 8 logical processors (1 physical, HT ratio 8:1) |
| **Physical Memory** | 6,349 MB total |
| **SQL Committed** | 416 MB / Target 3,859 MB |
| **Uptime** | < 1 hour (started May 25, 2026 13:12:48 UTC) |

#### **Database Inventory**
| Database | Size | Recovery Model | State | Log Reuse Wait |
|----------|------|----------------|-------|----------------|
| **TestDB** 🔥 | **272 MB** (72 data + 200 log) | FULL | ONLINE | NOTHING |
| **ProductsDB** | 16 MB (8 data + 8 log) | FULL | ONLINE | NOTHING |
| tempdb | 72 MB (64 data + 8 log) | SIMPLE | ONLINE | NOTHING |
| master | 5 MB | SIMPLE | ONLINE | CHECKPOINT |
| model | 16 MB | FULL | ONLINE | NOTHING |
| msdb | 14 MB | SIMPLE | ONLINE | NOTHING |

**Note:** TestDB has grown significantly after batch inserts of 100,000 rows. Transaction log is 200 MB and actively being used.

---

### **2. Active Sessions Analysis (SqlServer1)**

#### **🔥 Live Session Activity**

5 active sessions detected at capture time (May 25, 2026 13:31:58 UTC):

| Session ID | Login | Status | Command | Wait Type | Wait (sec) | Blocking By | Database | Description |
|------------|-------|--------|---------|-----------|------------|-------------|----------|-------------|
| **51** | sa | running | WAITFOR | WAITFOR | 41 | - | TestDB | 🔴 **BLOCKER** - Holding transaction locks |
| **52** | sa | running | UPDATE | LCK_M_X | 32 | **51** | TestDB | 🔴 **BLOCKED** - Waiting for exclusive lock |
| **55** | sa | running | SELECT | LCK_M_S | 24 | **51** | TestDB | 🔴 **BLOCKED** - Waiting for shared lock |
| 58 | dba_monitor | running | EXECUTE | - | 0 | - | master | ℹ️ Monitoring query (MCP) |
| 66 | dba_monitor | running | SELECT | - | 0 | - | master | ℹ️ Monitoring query (MCP) |

**Analysis:**  
- **Session 51** is executing a WAITFOR DELAY command, holding locks acquired during an UPDATE on rows 1000-2000
- **Session 52** is blocked for 32 seconds trying to acquire an exclusive lock (UPDATE statement)
- **Session 55** is blocked for 24 seconds trying to acquire a shared lock (SELECT statement)
- MCP monitoring sessions (58, 66) are not impacted and running normally

---

### **3. Wait Statistics Analysis (SqlServer1)**

#### **Top Wait Types (Since Restart)**
| Wait Type | % Total | Wait Count | Total Wait (ms) | Avg Wait (ms) | Classification |
|-----------|---------|------------|-----------------|---------------|----------------|
| **PREEMPTIVE_OS_CRYPTOPS** | 41.09% | 483 | 63,066 | 131 | ⚠️ Cryptographic operations (cert auth) |
| **WRITELOG** | 14.16% | 100,555 | 21,729 | 0.2 | 🔴 **Transaction log writes** |
| **STARTUP_DEPENDENCY_MANAGER** | 10.34% | 146 | 15,865 | 109 | ℹ️ Startup waits |
| **PWAIT_ALL_COMPONENTS_INITIALIZED** | 9.50% | 3 | 14,585 | 4,862 | ℹ️ Startup waits |
| **PREEMPTIVE_OS_AUTHENTICATIONOPS** | 7.61% | 339 | 11,687 | 34 | ℹ️ Authentication |
| **CHKPT** | 4.79% | 1 | 7,349 | 7,349 | ℹ️ Checkpoint |
| **ASYNC_IO_COMPLETION** | 2.13% | 12 | 3,266 | 272 | ℹ️ Async I/O |
| **SOS_SCHEDULER_YIELD** | 1.85% | 2,826 | 2,844 | 1 | ⚠️ **CPU pressure indicator** |

**Analysis:**  
🔴 **WRITELOG waits are elevated** - 100,555 wait events totaling 21.7 seconds from the batch insert workload (100k INSERTs)  
⚠️ **SOS_SCHEDULER_YIELD** - 2,826 occurrences indicate moderate CPU pressure from the workload  
⚠️ **PREEMPTIVE_OS_CRYPTOPS** - High crypto operations from AG certificate setup (41% of total waits)  

**Impact:** The environment is showing expected wait patterns for a write-heavy workload. WRITELOG waits are normal for bulk inserts into a FULL recovery database.

---

### **4. Query Performance (SqlServer1)**

#### **Top 5 Queries by CPU**
| Rank | Avg CPU (ms) | Executions | Total CPU (ms) | Avg Reads | Query Description |
|------|--------------|------------|----------------|-----------|-------------------|
| **1** | 0 | **50,000** | 2,164 | 3 | 🔥 **INSERT batch 1** - `INSERT INTO TestData (TestValue, CreatedAt) VALUES (...)` |
| **2** | 0 | **50,000** | 1,912 | 3 | 🔥 **INSERT batch 2** - `INSERT INTO TestData (TestValue, CreatedAt) VALUES (...)` |
| 3 | 791 | 1 | 791 | 188,458 | System metadata query (scalar functions) |
| 4 | 170 | 1 | 170 | 0 | External REST endpoint counters query |
| 5 | 153 | 1 | 153 | 30 | Loaded modules query (MSDTC) |

**Analysis:**  
🔥 **100,000 INSERT statements executed** - Two batches of 50k inserts each  
- Batch 1: 2,164 ms total CPU (43 µs avg per insert)  
- Batch 2: 1,912 ms total CPU (38 µs avg per insert)  
- Total logical reads: 309,693 pages (2.4 GB)  
- Total logical writes: 627 pages (4.9 MB)

**Performance:** Excellent insert performance at ~50,000 rows/second. Low per-operation latency indicates healthy I/O subsystem.

---

### **5. Memory Usage (SqlServer1)**

#### **Memory Breakdown**
| Component | Memory (MB) | Purpose |
|-----------|-------------|---------|
| **MEMORYCLERK_SQLBUFFERPOOL** | 114 MB | Buffer pool (data cache) ⬆️ |
| **CACHESTORE_SQLCP** | 78 MB | SQL Plans cache ⬆️ |
| **MEMORYCLERK_SOSNODE** | 68 MB | SOS scheduler nodes |
| **CACHESTORE_PHDR** | 45 MB | Bound Trees (query plans) |
| **MEMORYCLERK_SQLGENERAL** | 20 MB | General memory clerk |
| **System Available** | 3,271 MB | Free physical memory |

**Status:** ✅ Memory utilization is healthy and increased from workload activity:
- Buffer pool grew from 40 MB to 114 MB (+185%) after processing 100k rows
- Plan cache grew from 46 MB to 78 MB (+70%) from new query plans
- System still has 3.2 GB free physical memory
- SQL Server target memory is 3,859 MB with 416 MB committed

---

### **6. I/O Performance (SqlServer1)**

#### **Top 5 Files by Activity**
| Database | File Type | Reads | Writes | Avg Read (ms) | Avg Write (ms) | Total Stall (ms) |
|----------|-----------|-------|--------|---------------|----------------|------------------|
| **TestDB** | **LOG** | 19 | **100,098** | 0 | **0.15** | 15,129 |
| **TestDB** | DATA | 35 | 106 | 0 | 2 | 299 |
| master | LOG | 12 | 169 | 1 | 1 | 298 |
| master | DATA | 73 | 120 | 2 | 1 | 283 |
| msdb | LOG | 1 | 129 | 0 | 2 | 254 |

**Analysis:**  
🔥 **TestDB transaction log** - Extremely high write activity (100,098 writes, 391 MB written)  
✅ **Excellent write latency** - Average write latency of 0.15ms is outstanding  
✅ **All files show sub-5ms latencies** - I/O subsystem is performing excellently under load

**Disk Space:**  
- TestDB log file: 200 MB (on disk)  
- Volume free space: 396 GB (87.7% free)  
- No space concerns

**Thresholds:**  
- < 5 ms = Excellent ✅ ← **Current state**  
- 5–20 ms = Good  
- 20–50 ms = Acceptable  
- > 50 ms = Concerning

---

### **7. Backup Status (SqlServer1)**

| Database | Recovery Model | Last Full Backup | Age (days) | Last Log Backup | Backup Health |
|----------|----------------|------------------|------------|-----------------|---------------|
| **TestDB** | FULL | ❌ Never | N/A | ❌ Never | ⚠️ **NEVER_BACKED_UP** |
| **ProductsDB** | FULL | ❌ Never | N/A | ❌ Never | ⚠️ **NEVER_BACKED_UP** |

#### **⚠️ Backup Compliance Issues**

**TestDB:** Database contains 100,005 rows of data (272 MB) with 200 MB transaction log, but has **NEVER been backed up**. In production, this would represent unacceptable data loss exposure.

**Action Required (for production):**
- Take immediate full backup: `BACKUP DATABASE [TestDB] TO DISK = '/var/backups/TestDB_Full.bak'`
- Schedule log backups every 15-60 minutes to allow log truncation
- Consider switching to SIMPLE recovery if point-in-time recovery is not needed

---

### **8. Additional Diagnostics (SqlServer1)**

#### **Long-Running Transactions**
⚠️ **1 long-running transaction** detected (session 51 holding locks for 41+ seconds)

#### **Deadlocks**
✅ **None detected** in system_health ring buffer

#### **Missing Indexes**
✅ **None** with impact score ≥ 50%  
(Note: TestData table has clustered index on ID, no missing index recommendations at this time)

#### **SQL Agent Jobs**
ℹ️ No SQL Agent jobs configured

#### **VLF Health**
| Database | VLF Count | Log Size | Health |
|----------|-----------|----------|--------|
| TestDB | **16** | 200 MB | ✅ OK |
| ProductsDB | 4 | 8 MB | ✅ OK |

✅ All databases have healthy VLF counts (< 500)  
ℹ️ TestDB log grew from 8 MB to 200 MB during insert workload, VLF count increased from 4 to 16 (still healthy)

#### **TempDB Usage**
✅ Minimal usage: 3-4 MB allocated, < 1 MB consumed by active sessions

---

## **Instance 2: SqlServer2 (Secondary - Idle)**

### **1. Infrastructure Overview**

#### **Server Configuration**
| Property | Value |
|----------|-------|
| **SQL Server Version** | 2025 Enterprise Developer (17.0.4005.7) RTM |
| **Server Name** | sqlserver2 |
| **HADR Enabled** | ✅ Yes (pre-configured for AG) |
| **Clustered** | ❌ No (cluster-less capable) |
| **CPU Count** | 8 logical processors (1 physical, HT ratio 8:1) |
| **Physical Memory** | 6,349 MB total |
| **SQL Committed** | 308 MB / Target 3,752 MB |
| **Uptime** | < 1 hour (started May 25, 2026 13:12:48 UTC) |

#### **Configuration Status**

| Setting | Current Value | Recommendation | Status |
|---------|--------------|----------------|--------|
| **max server memory (MB)** | 2,147,483,647 (unlimited) | Set to ~4,800 MB | ⚠️ **NEEDS TUNING** |
| **MAXDOP** | 0 (unlimited) | Set to 4 | ⚠️ **NEEDS TUNING** |
| **cost threshold for parallelism** | 5 | Increase to 50 | ⚠️ **NEEDS TUNING** |
| **optimize for ad hoc workloads** | 0 (OFF) | Enable (1) | ⚠️ **NEEDS TUNING** |

**Finding:** SqlServer2 has the same configuration concerns as SqlServer1. Both instances need identical tuning to ensure consistent performance.

---

### **2. Wait Statistics (SqlServer2)**

#### **Top Wait Types**
| Wait Type | % Total | Classification |
|-----------|---------|----------------|
| **BROKER_EVENTHANDLER** | 99.22% | ℹ️ **Benign** (Service Broker idle) |
| **DIRTY_PAGE_POLL** | 0.41% | ℹ️ Checkpoint monitoring |

**Analysis:** Wait statistics show a clean, idle environment. No user workload has been executed on this instance. All waits are benign background tasks.

---

### **3. Blocking & Active Sessions (SqlServer2)**

✅ **No blocking detected**  
✅ **No active user sessions** (only monitoring queries from MCP server)

---

## **Multi-Instance Architecture Status**

### **Connection Manager Configuration**

The sql-mcp-server uses a multi-instance connection manager that routes tool calls to the appropriate SQL Server instance. Configuration is defined in the `INSTANCES` environment variable:

```json
[
  {"name":"SqlServer1","host":"sqlserver1","port":1433,"user":"dba_monitor","password":"[REDACTED]"},
  {"name":"SqlServer2","host":"sqlserver2","port":1433,"user":"dba_monitor","password":"[REDACTED]"}
]
```

**Current State:**  
✅ Both instances are registered in the connection manager  
✅ Network connectivity is working  
✅ Authentication successful on both instances  
✅ All MCP diagnostic tools functioning properly  
✅ Real-time blocking detection operational

---

## **Always On Availability Groups Status**

### **⚠️ AG PARTIALLY CONFIGURED**

**Status:** ❌ AG setup script executed but verification failed - no AG detected by monitoring tools

**What happened:**
- AG setup script (`./scripts/ag/setup-ag.sh`) was executed
- TestDB was created with 5 initial rows, then manually expanded to 100,005 rows
- Certificate creation and endpoint setup may have succeeded
- AG creation or database addition may have failed (verification shows "No Always On Availability Groups configured")

**Evidence of partial success:**
- TestDB exists on primary with 100,005 rows
- HADR is enabled on both instances
- Certificates were likely created (high PREEMPTIVE_OS_CRYPTOPS waits)

**Next steps to diagnose:**
```sql
-- Check AG status
SELECT * FROM sys.availability_groups;
SELECT * FROM sys.availability_replicas;
SELECT * FROM sys.dm_hadr_availability_replica_states;

-- Check endpoints
SELECT * FROM sys.database_mirroring_endpoints;

-- Check certificates
SELECT name FROM sys.certificates WHERE name LIKE '%sqlserver%';
```

---

## **Recommendations**

### **🔴 CRITICAL (Immediate Action)**

1. **Resolve blocking situation (if not intentional)**  
   ```sql
   -- Identify blocker
   EXEC sp_who2 51;
   
   -- Kill blocking session (if appropriate)
   KILL 51;
   ```

2. **Take backup of TestDB**  
   Database contains 100k rows with no backup protection:
   ```sql
   BACKUP DATABASE [TestDB] 
   TO DISK = '/var/opt/mssql/backup/TestDB_Full.bak' 
   WITH COMPRESSION, STATS = 10;
   ```

### **🟡 IMPORTANT (Configuration)**

3. **Configure max server memory on both instances**  
   Set to 4,800 MB (75% of available RAM):
   ```sql
   USE [master];
   EXEC sp_configure 'show advanced options', 1;
   RECONFIGURE;
   EXEC sp_configure 'max server memory (MB)', 4800;
   RECONFIGURE;
   ```

4. **Tune sp_configure settings on both instances:**
   ```sql
   EXEC sp_configure 'max degree of parallelism', 4;
   EXEC sp_configure 'cost threshold for parallelism', 50;
   EXEC sp_configure 'optimize for ad hoc workloads', 1;
   RECONFIGURE;
   ```

5. **Diagnose AG configuration issue**  
   Review logs and verify AG components:
   ```bash
   # Check SQL error log
   docker exec sql-mcp-sqlserver1 tail -100 /var/opt/mssql/log/errorlog
   
   # Verify certificates and endpoints
   docker exec sql-mcp-sqlserver1 /opt/mssql-tools18/bin/sqlcmd -S localhost \
     -U sa -P 'S0methingS@Str0ng!' -C \
     -Q "SELECT * FROM sys.certificates; SELECT * FROM sys.database_mirroring_endpoints;"
   ```

### **🟢 OPTIONAL (Performance Monitoring)**

6. **Monitor blocking chains during production workloads**  
   Use `get_blocking_chains` MCP tool to detect blocking in real-time

7. **Analyze query performance after resolving blocking**  
   Current INSERT performance is excellent (50k rows/sec) - establish this as baseline

8. **Review wait statistics after workload completes**  
   WRITELOG waits are expected to normalize after bulk insert completes

9. **Consider shrinking TestDB log if growth is not expected to repeat**  
   ```sql
   -- After taking log backup
   DBCC SHRINKFILE (TestDB_log, 8);
   ```

---

## **Summary**

### **Fleet Health: ⚠️ ACTIVE WORKLOAD WITH BLOCKING**

This SQL Server environment is demonstrating real-world production scenarios with active workload and blocking conditions:

**🔴 Critical Findings:**
- **Active blocking** - 2 sessions blocked by a long-running transaction (intentional for demo)
- Session 51 holding locks for 41+ seconds with WAITFOR DELAY
- No backups configured for TestDB (100k rows, 272 MB data)

**✅ Positive Observations:**
- **Outstanding I/O performance** - 0.15ms average write latency on transaction log
- **Excellent insert performance** - 50,000 rows/second sustained throughput
- **Healthy memory utilization** - Buffer pool and plan cache growing appropriately
- **No deadlocks detected** - Clean concurrency management
- **Multi-instance monitoring working perfectly** - MCP tools captured blocking in real-time

**⚠️ Configuration Gaps:**
- max server memory unlimited on both instances
- MAXDOP=0, CTFP=5, ad hoc workloads optimization disabled
- AG partially configured (setup script ran but verification shows no AG)

**Workload Characteristics:**
- **100,005 rows** inserted in TestDB via two batches
- **100,098 transaction log writes** (391 MB written)
- **21.7 seconds** of WRITELOG waits from bulk insert workload
- **2,826 CPU yields** (SOS_SCHEDULER_YIELD) indicating moderate CPU pressure
- **Blocking scenario** created intentionally to demonstrate monitoring capabilities

**Environment Readiness:**
- ✅ **Demo/Testing:** Perfectly demonstrates monitoring, blocking detection, and workload analysis
- ⚠️ **Production:** Requires backup strategy and blocking resolution
- ℹ️ **High Availability:** AG issue needs diagnosis and resolution

**Next Steps:**
1. Resolve blocking (KILL 51 or wait for WAITFOR to complete)
2. Take backup of TestDB
3. Apply sp_configure settings on both instances
4. Diagnose and fix AG configuration issue
5. Re-run health report to confirm clean state

---

## **How This Report Was Generated**

This comprehensive multi-instance health report was generated using the **sql-mcp-server** with 15+ MCP tools while the system was under active workload:

### **Tools Used:**
- `list_instances` - Discovered 2 SQL Server instances
- `get_server_info` - Version, edition, CPU, memory, uptime (both instances)
- `get_database_info` - Database inventory and recovery models
- `get_wait_stats` - Wait statistics analysis showing WRITELOG waits (both instances)
- `get_active_sessions` - **Captured 5 active sessions including blocker and blocked sessions**
- `get_blocking_chains` - **🔥 Detected active blocking scenario (2 blocked sessions)**
- `get_memory_usage` - Memory clerk breakdown (both instances)
- `get_backup_status` - Backup compliance check
- `get_ag_health` - Always On Availability Group status check
- `get_top_queries` - Query performance showing 100k INSERT operations
- `get_missing_indexes` - Index recommendations
- `get_file_io_stats` - I/O performance metrics showing 100k log writes
- `get_vlf_count` - Transaction log health
- `get_tempdb_usage` - TempDB space analysis
- `get_job_status` - SQL Agent job status
- `get_deadlock_history` - Deadlock detection

### **Workload Scenario:**
1. AG setup script executed (`./scripts/ag/setup-ag.sh`)
2. TestDB created and populated with 100,005 rows via batch inserts
3. Long-running transaction started (UPDATE with WAITFOR DELAY)
4. Second UPDATE attempted (blocked - waiting for exclusive lock)
5. SELECT query attempted (blocked - waiting for shared lock)
6. Background SELECT workload running
7. Health report captured while blocking in progress

### **Instance Coverage:**
- **SqlServer1:** Full diagnostics with active workload and blocking
- **SqlServer2:** Full diagnostics showing idle state

### **Data Freshness:**
Real-time snapshot captured at **May 25, 2026 13:32 UTC** during active blocking scenario

---

**Report Generated by:** SQL MCP Server (sql-dba)  
**Multi-Instance Architecture:** 1 MCP server → 2 SQL Server instances  
**Monitoring Capability:** Real-time blocking detection, wait stats, query performance  
**Repository:** https://github.com/nocentino/sql-mcp-server

---

## **Comparison: Idle vs. Under Load**

This report demonstrates the power of the SQL MCP monitoring server to capture real production scenarios. Compare this report to the baseline report (`multi-instance-health-report.md`) to see the difference between:

**Baseline (Idle):**
- 5 rows in TestDB
- No blocking
- Minimal WRITELOG waits
- Clean wait statistics
- No active user sessions

**Under Load (This Report):**
- 🔥 **100,005 rows** in TestDB (+19,999x growth)
- 🔴 **Active blocking** (2 blocked sessions)
- 🔴 **100,098 log writes** (391 MB)
- ⚠️ **21.7 seconds WRITELOG waits**
- 🔥 **5 active sessions** (3 user + 2 monitoring)

**Key Insight:** The MCP monitoring tools successfully detected and reported the blocking scenario in real-time, demonstrating their value for production database monitoring and troubleshooting.
