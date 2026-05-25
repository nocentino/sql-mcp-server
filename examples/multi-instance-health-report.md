# **SQL Server Multi-Instance Environment Health Report**
### Generated: May 25, 2026 | Environment: sql-mcp Demo

---

## **Executive Summary**

**Environment:** 2 SQL Server instances detected  
**Primary Instance (SqlServer1):** ✅ **HEALTHY** with minor configuration concerns  
**Secondary Instance (SqlServer2):** ⚠️ **MONITORING ACCESS DENIED** - dba_monitor user not configured  
**Critical Issues:** 1 (Monitoring user missing on secondary replica)  
**Warnings:** 2 (Configuration tuning recommended, Backup compliance)  
**High Availability:** TestAG - SYNCHRONIZED and HEALTHY

---

## **Environment Overview**

### **Instance Discovery**

| Instance Name | Host | Port | User | Status |
|--------------|------|------|------|--------|
| **SqlServer1** | sqlserver | 1433 | dba_monitor | ✅ **ACCESSIBLE** |
| **SqlServer2** | sqlserver2 | 1433 | dba_monitor | ❌ **LOGIN FAILED** |

**Finding:** The `dba_monitor` user exists on SqlServer1 but was not created on SqlServer2 (the secondary AG replica). This prevents remote monitoring and diagnostics on the secondary instance.

**Impact:** Cannot retrieve wait stats, session activity, backup status, or performance metrics from the secondary replica without authentication.

**Recommendation:** Create the dba_monitor login on SqlServer2 with appropriate VIEW SERVER STATE and VIEW DATABASE STATE permissions to enable full fleet monitoring.

---

## **Instance 1: SqlServer1 (Primary)**

### **1. Infrastructure Overview**

#### **Server Configuration**
| Property | Value |
|----------|-------|
| **SQL Server Version** | 2025 Enterprise Developer (17.0.4005.7) RTM |
| **Server Name** | sqlserver |
| **HADR Enabled** | ✅ Yes (Always On configured) |
| **Clustered** | ❌ No (cluster-less AG) |
| **CPU Count** | 8 logical processors (1 physical, HT ratio 8:1) |
| **Physical Memory** | 6,349 MB total / 3,424 MB available |
| **SQL Committed** | 482 MB / Target 3,574 MB |
| **Uptime** | 17 hours (started May 24, 2026 19:42:30 UTC) |

#### **Database Inventory**
| Database | Size | Recovery Model | State | Log Reuse Wait |
|----------|------|----------------|-------|----------------|
| **TestDB** | 144 MB (72 data + 72 log) | FULL | ONLINE | LOG_BACKUP ⚠️ |
| **ProductsDB** | 75 MB (72 data + 3 log) | SIMPLE | ONLINE | NOTHING |
| tempdb | 72 MB (64 data + 8 log) | SIMPLE | ONLINE | NOTHING |
| master | 6 MB | SIMPLE | ONLINE | NOTHING |
| model | 16 MB | FULL | ONLINE | NOTHING |
| msdb | 16 MB | SIMPLE | ONLINE | OLDEST_PAGE |

---

### **2. High Availability Status**

#### **Always On Availability Group: TestAG**
| Replica | Role | Sync Mode | Sync State | Health | Send Queue | Redo Queue | Send Rate | Redo Rate |
|---------|------|-----------|------------|--------|------------|------------|-----------|-----------|
| **sqlserver** | PRIMARY | SYNCHRONOUS | SYNCHRONIZED | ✅ HEALTHY | N/A | N/A | N/A | N/A |
| **sqlserver2** | SECONDARY | SYNCHRONOUS | SYNCHRONIZED | ✅ HEALTHY | 0 MB | 0 MB | 3 MB/s | 23 MB/s |

**Status:** ✅ All replicas CONNECTED and SYNCHRONIZED  
**Estimated Data Loss:** 0 seconds  
**Estimated Recovery Time:** 0 seconds  
**Last Commit:** May 25, 2026 11:55:15 UTC  
**Database:** TestDB (50,005 rows synchronized)

**Note:** The AG health data is retrieved from the PRIMARY replica. Without access to SqlServer2, we cannot independently verify secondary replica health metrics or detect issues specific to that instance.

---

### **3. Configuration Analysis**

#### **⚠️ Configuration Concerns (SqlServer1)**

| Setting | Current Value | Recommendation | Impact |
|---------|--------------|----------------|---------|
| **max server memory (MB)** | 2,147,483,647 (unlimited) | Set to ~4,800 MB (75% of 6.3 GB) | Prevents OS memory starvation |
| **MAXDOP** | 0 (unlimited) | Set to 4 (half of logical CPUs) | Reduces excessive parallelism |
| **cost threshold for parallelism** | 5 | Increase to 50 | Prevents over-parallelization on small queries |
| **optimize for ad hoc workloads** | 0 (OFF) | Enable (1) | Reduces plan cache pollution |

**Action Required:** Update configuration via sp_configure for production stability. These settings should be synchronized across both instances in the AG.

---

### **4. Wait Statistics Analysis (SqlServer1)**

#### **Top Wait Types (Since Restart)**
| Wait Type | % Total | Wait Count | Total Wait (ms) | Avg Wait (ms) | Classification |
|-----------|---------|------------|-----------------|---------------|----------------|
| **HADR_TIMER_TASK** | 95.05% | 17,337 | 8,877,621 | 512 | ℹ️ **Benign** (AG background task) |
| **PREEMPTIVE_OS_CRYPTOPS** | 2.99% | 2,740 | 278,986 | 102 | ℹ️ Cryptographic operations (AG certificates) |
| **SOS_SCHEDULER_YIELD** | 0.12% | 6,003 | 11,571 | 2 | ⚠️ CPU pressure (minor) |
| **LCK_M_S** | 0.11% | 7 | 10,046 | 1,435 | 🔒 Shared lock waits |

**Analysis:** Wait statistics dominated by HADR timer tasks (expected with Always On). Minimal CPU pressure (SOS_SCHEDULER_YIELD < 1%) and very low lock contention. No I/O pressure detected (no PAGEIOLATCH waits in top 10).

**Secondary Instance Wait Stats:** ❌ **NOT AVAILABLE** - Cannot retrieve wait stats from SqlServer2 due to authentication failure.

---

### **5. Query Performance (SqlServer1)**

#### **Top 5 Queries by CPU**
| Rank | Avg CPU (ms) | Executions | Total CPU (ms) | Avg Reads | Query Description |
|------|--------------|------------|----------------|-----------|-------------------|
| 1 | 496 | 1 | 496 | 188,266 | Scalar function analysis (system query) |
| 2 | 16 | 29 | 473 | 2 | Extended events telemetry ring buffer read |
| 3 | 15 | 50 | 755 | 2,173 | **INSERT INTO Orders** (50k row bulk load) |
| 4 | 0 | 893 | 552 | 2 | DAB - Orders JSON query |
| 5 | 0 | 893 | 459 | 2 | DAB - Categories JSON query |

**Top CPU Consumer:** The Orders bulk insert (50 executions @ 15ms avg) used 755ms total CPU with 108,678 logical reads. This was the planned 50,000-row workload. Performance is excellent for the data volume.

**DAB Queries:** All DAB-generated JSON queries execute efficiently (893 calls each, < 1ms avg CPU).

---

### **6. Memory Usage (SqlServer1)**

#### **Memory Breakdown**
| Component | Memory (MB) | Purpose |
|-----------|-------------|---------|
| **MEMORYCLERK_SOSNODE** | 59 MB | SOS scheduler nodes |
| **CACHESTORE_PHDR** | 57 MB | Bound Trees (query plans) |
| **MEMORYCLERK_SQLBUFFERPOOL** | 52 MB | Buffer pool (data cache) |
| **CACHESTORE_SQLCP** | 52 MB | SQL Plans cache |
| **MEMORYCLERK_SQLGENERAL** | 25 MB | General memory clerk |
| **System Available** | 3,424 MB | Free physical memory |

**Status:** ✅ Memory utilization is healthy. System has 3.4 GB free. Buffer pool is only 52 MB due to small database sizes and limited workload since restart.

---

### **7. I/O Performance (SqlServer1)**

#### **Top 5 Files by Latency**
| Database | File Type | Reads | Writes | Avg Read (ms) | Avg Write (ms) | Total Stall (ms) |
|----------|-----------|-------|--------|---------------|----------------|------------------|
| tempdb | DATA | 34 | 4 | **18** ⚠️ | 0 | 628 |
| ProductsDB | LOG | 8 | 1,047 | 5 | 0 | 483 |
| msdb | DATA | 99 | 4 | 3 | 3 | 382 |
| ProductsDB | DATA | 129 | 70 | 2 | 1 | 357 |
| master | DATA | 81 | 39 | 3 | 1 | 331 |

**Analysis:**  
✅ **Excellent I/O performance.** All files show sub-5ms latencies except tempdb DATA (18ms avg, acceptable for temp storage).  
✅ **Disk space:** 396 GB available (87.7% free) on all volumes.

**Thresholds:**  
- < 5 ms = Excellent ✅  
- 5–20 ms = Good ✅  
- 20–50 ms = Acceptable  
- > 50 ms = Concerning ⚠️

---

### **8. Backup Status (SqlServer1)**

| Database | Recovery Model | Last Full Backup | Age (days) | Last Log Backup | Backup Health |
|----------|----------------|------------------|------------|-----------------|---------------|
| **ProductsDB** | SIMPLE | May 23, 2026 20:43 | 2 | N/A (SIMPLE) | ✅ OK |
| **TestDB** | FULL | May 24, 2026 19:46 | 1 | ❌ Never | ⚠️ **NO_LOG_BACKUPS** |

#### **⚠️ Backup Compliance Issues**

**TestDB:** Database is in FULL recovery mode but has NEVER had a log backup. Transaction log cannot be truncated until a log backup is taken.  
- **Current log size:** 72 MB  
- **Log reuse wait:** LOG_BACKUP  
- **Action Required:** Schedule log backups every 15-60 minutes for FULL recovery databases.

**System Databases:** master, model, msdb have never been backed up. Recommend weekly full backups.

---

### **9. Additional Diagnostics (SqlServer1)**

#### **Active Sessions**
✅ **No blocking detected**  
2 active sessions (both dba_monitor connections from MCP server performing diagnostics)

#### **Long-Running Transactions**
✅ **None** (threshold: > 30 seconds)

#### **Deadlocks**
✅ **None detected** in system_health ring buffer

#### **Missing Indexes**
✅ **None** with impact score ≥ 50%

#### **SQL Agent Jobs**
ℹ️ No SQL Agent jobs configured

#### **VLF Health**
| Database | VLF Count | Log Size | Health |
|----------|-----------|----------|--------|
| TestDB | 8 | 72 MB | ✅ OK |
| ProductsDB | 2 | 3 MB | ✅ OK |

✅ All databases have healthy VLF counts (< 1000)

#### **TempDB Usage**
✅ Minimal usage: 3 MB allocated, < 1 MB consumed by active sessions

#### **Latch Statistics**
Top latch: BUFFER (601 waits, 2ms avg) - normal memory page access, no contention issues

---

## **Instance 2: SqlServer2 (Secondary)**

### **⚠️ MONITORING ACCESS DENIED**

**Status:** ❌ **AUTHENTICATION FAILURE**  
**Error:** `Login failed for user 'dba_monitor'`  
**Root Cause:** The dba_monitor login exists on SqlServer1 but was not created on SqlServer2

### **What We Know (from Primary Replica)**

The following information about SqlServer2 is retrieved indirectly through the AG health query on the primary:

| Property | Value (from AG metadata) |
|----------|--------------------------|
| **Role** | SECONDARY |
| **Replica Server** | sqlserver2 |
| **Sync Mode** | SYNCHRONOUS_COMMIT |
| **Sync State** | SYNCHRONIZED |
| **Health** | ✅ HEALTHY |
| **Connected** | ✅ YES |
| **Send Queue** | 0 MB |
| **Redo Queue** | 0 MB |
| **Send Rate** | 3 MB/s |
| **Redo Rate** | 23 MB/s |

### **What We Cannot Verify**

Without direct access to SqlServer2, the following diagnostics are unavailable:

- ❌ Server configuration (max memory, MAXDOP, etc.)
- ❌ Wait statistics (CPU pressure, I/O waits, lock contention)
- ❌ Active sessions and blocking
- ❌ Query performance metrics
- ❌ Memory usage breakdown
- ❌ I/O performance and latency
- ❌ Backup status on secondary
- ❌ TempDB usage
- ❌ Plan cache analysis
- ❌ Independent verification of database states

### **Risk Assessment**

**Operational Risk:** ⚠️ **MEDIUM**

Without monitoring access to the secondary replica:
1. Cannot detect performance issues specific to the secondary
2. Cannot verify backup strategy on secondary (though AG provides HA, backups are still needed)
3. Cannot identify resource bottlenecks during failover scenarios
4. Cannot detect secondary-specific blocking or deadlocks
5. Cannot verify configuration consistency between replicas

**Availability Risk:** ✅ **LOW**  
The AG health indicates the secondary is synchronized and healthy. In a failover scenario, data loss would be zero. However, post-failover performance cannot be predicted without baseline metrics from the secondary.

---

## **Multi-Instance Architecture Status**

### **Connection Manager Configuration**

The sql-mcp-server uses a multi-instance connection manager that routes tool calls to the appropriate SQL Server instance. Configuration is defined in the `INSTANCES` environment variable:

```json
[
  {"name":"SqlServer1","host":"sqlserver", "port":1433,"user":"dba_monitor","password":"MonitorP@ss123!"},
  {"name":"SqlServer2","host":"sqlserver2","port":1433,"user":"dba_monitor","password":"MonitorP@ss123!"}
]
```

**Current State:**  
✅ Both instances are registered in the connection manager  
✅ Network connectivity is working (AG replication functioning)  
❌ Authentication fails on SqlServer2 (user does not exist)

---

## **Recommendations**

### **🔴 CRITICAL (Address Immediately)**

1. **Create dba_monitor login on SqlServer2**
   ```sql
   -- Run on SqlServer2
   USE [master];
   CREATE LOGIN [dba_monitor] WITH PASSWORD = 'MonitorP@ss123!';
   GRANT VIEW SERVER STATE TO [dba_monitor];
   GRANT VIEW ANY DATABASE TO [dba_monitor];
   GRANT VIEW ANY DEFINITION TO [dba_monitor];
   ```
   This enables full diagnostic capabilities on the secondary replica.

2. **Configure log backups for TestDB**  
   Database in FULL recovery with no log backups poses data loss risk and prevents log truncation.

3. **Set max server memory on both instances**  
   Set to 4,800 MB (75% of available RAM) to prevent OS starvation. Verify consistent configuration across both instances.

### **🟡 IMPORTANT (Address Soon)**

4. **Synchronize sp_configure settings across AG replicas:**
   - Set MAXDOP = 4 (half of logical CPUs)
   - Set cost threshold for parallelism = 50
   - Enable "optimize for ad hoc workloads" = 1
   
   These should be identical on primary and secondary to ensure consistent performance after failover.

5. **Implement system database backups**  
   master, model, msdb should be backed up weekly. These are NOT protected by the AG.

6. **Enable Query Store on TestDB**  
   Provides plan regression detection and performance history across failovers.

7. **Create SQL Agent jobs for monitoring**  
   - Log backups every 15 minutes (TestDB)
   - Full backups daily (all databases)
   - Index maintenance weekly
   - Statistics updates weekly

### **🟢 OPTIONAL (Performance Tuning)**

8. **Establish performance baselines on both instances**  
   Once dba_monitor access is restored, capture baseline metrics during normal operations to detect performance anomalies.

9. **Configure AG backup preferences**  
   Currently all backups run on primary. Consider using BACKUP_PRIORITY to offload backups to secondary replica.

10. **Monitor wait stats trending**  
    Current environment is very light. Re-assess wait stats after workload increases.

---

## **Summary**

### **Fleet Health: ⚠️ PARTIALLY MONITORED**

This SQL Server environment consists of 2 instances configured in a cluster-less Always On Availability Group. The primary instance (SqlServer1) is in excellent health with synchronized data replication to the secondary (SqlServer2). However, monitoring capabilities are limited due to missing authentication on the secondary replica.

**Key Strengths:**
- Always On AG fully synchronized and healthy
- Excellent I/O performance on primary instance
- Zero data loss exposure (synchronous commit)
- No blocking, deadlocks, or performance issues on primary
- Clean plan cache with efficient query execution
- Healthy VLF counts and tempdb usage

**Key Gaps:**
- **CRITICAL:** No monitoring access to secondary replica (dba_monitor user missing)
- **CRITICAL:** TestDB log backups not configured (FULL recovery mode without log backups)
- Configuration tuning needed on both instances (max memory, MAXDOP)
- System databases not backed up
- No SQL Agent jobs configured for maintenance

**Action Items:**
1. Create dba_monitor login on SqlServer2 immediately to restore full monitoring
2. Implement log backup strategy for TestDB
3. Synchronize sp_configure settings across both AG replicas
4. Add system database backups to backup strategy

The 50,000-row insert workload completed successfully with excellent performance (15ms avg, 2,173 logical reads per batch). The environment is architecturally sound but requires operational maturity improvements (monitoring access, backup compliance, configuration standardization) before production readiness.

---

## **How This Report Was Generated**

This comprehensive multi-instance health report was generated using the **sql-mcp-server** with 20+ MCP tools:

### **Tools Used:**
- `list_instances` - Discovered 2 SQL Server instances
- `get_server_info` - Version, edition, CPU, memory, uptime
- `get_database_info` - Database inventory and recovery models
- `get_wait_stats` - Wait statistics analysis
- `get_active_sessions` - Current session activity
- `get_blocking_chains` - Blocking detection
- `get_memory_usage` - Memory clerk breakdown
- `get_backup_status` - Backup compliance check
- `get_ag_health` - Always On Availability Group status (provides secondary health via primary)
- `get_top_queries` - Query performance analysis (by CPU)
- `get_missing_indexes` - Index recommendations
- `get_file_io_stats` - I/O performance metrics
- `get_vlf_count` - Transaction log health
- `get_long_running_transactions` - Transaction monitoring
- `get_job_status` - SQL Agent job status
- `get_deadlock_history` - Deadlock detection
- `get_plan_cache_pollution` - Plan cache analysis
- `get_cpu_history` - CPU utilization trends
- `get_tempdb_usage` - TempDB space analysis
- `get_perfmon_counters` - Performance counters
- `get_latch_stats` - Latch wait statistics
- `get_database_files` - File configuration

### **Instance Coverage:**
- **SqlServer1:** Full diagnostics retrieved (20+ tools)
- **SqlServer2:** Authentication failure prevented direct diagnostics. AG health retrieved indirectly via primary replica.

### **Data Freshness:**
Real-time snapshot captured at **May 25, 2026 12:12 UTC**

---

**Report Generated by:** SQL MCP Server (sql-dba)  
**Multi-Instance Architecture:** 1 MCP server → 2 SQL Server instances  
**Repository:** https://github.com/nocentino/sql-mcp-server
