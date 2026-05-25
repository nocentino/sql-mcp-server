# **SQL Server Environment Health Report**
### Generated: May 25, 2026 | Instance: SqlServer1 (sqlserver)

---

## **Executive Summary**

**Environment Status:** ✅ **HEALTHY** with minor configuration concerns  
**Uptime:** 17 hours since restart  
**Critical Issues:** None  
**Warnings:** 2 (Configuration tuning recommended, Backup compliance)  
**High Availability:** TestAG - SYNCHRONIZED and HEALTHY

---

## **1. Infrastructure Overview**

### **Server Configuration**
| Property | Value |
|----------|-------|
| **SQL Server Version** | 2025 Enterprise Developer (17.0.4005.7) RTM |
| **Server Name** | sqlserver |
| **HADR Enabled** | ✅ Yes (Always On configured) |
| **CPU Count** | 8 logical processors (1 physical, HT ratio 8:1) |
| **Physical Memory** | 6,349 MB total / 3,424 MB available |
| **SQL Committed** | 482 MB / Target 3,574 MB |
| **Uptime** | 17 hours (started May 24, 2026 19:42:30 UTC) |

### **Database Inventory**
| Database | Size | Recovery Model | State | Log Reuse Wait |
|----------|------|----------------|-------|----------------|
| **TestDB** | 144 MB (72 data + 72 log) | FULL | ONLINE | LOG_BACKUP ⚠️ |
| **ProductsDB** | 75 MB (72 data + 3 log) | SIMPLE | ONLINE | NOTHING |
| tempdb | 72 MB (64 data + 8 log) | SIMPLE | ONLINE | NOTHING |
| master | 6 MB | SIMPLE | ONLINE | NOTHING |
| model | 16 MB | FULL | ONLINE | NOTHING |
| msdb | 16 MB | SIMPLE | ONLINE | OLDEST_PAGE |

---

## **2. High Availability Status**

### **Always On Availability Group: TestAG**
| Replica | Role | Sync Mode | Sync State | Health | Send Queue | Redo Queue | Send Rate | Redo Rate |
|---------|------|-----------|------------|--------|------------|------------|-----------|-----------|
| **sqlserver** | PRIMARY | SYNCHRONOUS | SYNCHRONIZED | ✅ HEALTHY | N/A | N/A | N/A | N/A |
| **sqlserver2** | SECONDARY | SYNCHRONOUS | SYNCHRONIZED | ✅ HEALTHY | 0 MB | 0 MB | 3 MB/s | 23 MB/s |

**Status:** ✅ All replicas CONNECTED and SYNCHRONIZED  
**Estimated Data Loss:** 0 seconds  
**Estimated Recovery Time:** 0 seconds  
**Last Commit:** May 25, 2026 11:55:15 UTC

---

## **3. Configuration Analysis**

### **⚠️ Configuration Concerns**

| Setting | Current Value | Recommendation | Impact |
|---------|--------------|----------------|---------|
| **max server memory (MB)** | 2,147,483,647 (unlimited) | Set to ~4,800 MB (75% of 6.3 GB) | Prevents OS memory starvation |
| **MAXDOP** | 0 (unlimited) | Set to 4 (half of logical CPUs) | Reduces excessive parallelism |
| **cost threshold for parallelism** | 5 | Increase to 50 | Prevents over-parallelization on small queries |
| **optimize for ad hoc workloads** | 0 (OFF) | Enable (1) | Reduces plan cache pollution |

**Action Required:** Update configuration via sp_configure for production stability.

---

## **4. Wait Statistics Analysis**

### **Top Wait Types (Since Restart)**
| Wait Type | % Total | Wait Count | Total Wait (ms) | Avg Wait (ms) | Classification |
|-----------|---------|------------|-----------------|---------------|----------------|
| **HADR_TIMER_TASK** | 95.05% | 17,337 | 8,877,621 | 512 | ℹ️ **Benign** (AG background task) |
| **PREEMPTIVE_OS_CRYPTOPS** | 2.99% | 2,740 | 278,986 | 102 | ℹ️ Cryptographic operations (AG certificates) |
| **SOS_SCHEDULER_YIELD** | 0.12% | 6,003 | 11,571 | 2 | ⚠️ CPU pressure (minor) |
| **LCK_M_S** | 0.11% | 7 | 10,046 | 1,435 | 🔒 Shared lock waits |

**Analysis:** Wait statistics dominated by HADR timer tasks (expected with Always On). Minimal CPU pressure (SOS_SCHEDULER_YIELD < 1%) and very low lock contention. No I/O pressure detected (no PAGEIOLATCH waits in top 10).

---

## **5. Query Performance**

### **Top 5 Queries by CPU**
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

## **6. Memory Usage**

### **Memory Breakdown**
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

## **7. I/O Performance**

### **Top 5 Files by Latency**
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

## **8. Backup Status**

| Database | Recovery Model | Last Full Backup | Age (days) | Last Log Backup | Backup Health |
|----------|----------------|------------------|------------|-----------------|---------------|
| **ProductsDB** | SIMPLE | May 23, 2026 20:43 | 2 | N/A (SIMPLE) | ✅ OK |
| **TestDB** | FULL | May 24, 2026 19:46 | 1 | ❌ Never | ⚠️ **NO_LOG_BACKUPS** |

### **⚠️ Backup Compliance Issues**

**TestDB:** Database is in FULL recovery mode but has NEVER had a log backup. Transaction log cannot be truncated until a log backup is taken.  
- **Current log size:** 72 MB  
- **Log reuse wait:** LOG_BACKUP  
- **Action Required:** Schedule log backups every 15-60 minutes for FULL recovery databases.

**System Databases:** master, model, msdb have never been backed up. Recommend weekly full backups.

---

## **9. Additional Diagnostics**

### **Active Sessions**
✅ **No blocking detected**  
2 active sessions (both dba_monitor connections from MCP server performing diagnostics)

### **Long-Running Transactions**
✅ **None** (threshold: > 30 seconds)

### **Deadlocks**
✅ **None detected** in system_health ring buffer

### **Missing Indexes**
✅ **None** with impact score ≥ 50%

### **SQL Agent Jobs**
ℹ️ No SQL Agent jobs configured

### **VLF Health**
| Database | VLF Count | Log Size | Health |
|----------|-----------|----------|--------|
| TestDB | 8 | 72 MB | ✅ OK |
| ProductsDB | 2 | 3 MB | ✅ OK |

✅ All databases have healthy VLF counts (< 1000)

### **TempDB Usage**
✅ Minimal usage: 3 MB allocated, < 1 MB consumed by active sessions

### **Latch Statistics**
Top latch: BUFFER (601 waits, 2ms avg) - normal memory page access, no contention issues

---

## **10. Recommendations**

### **🔴 CRITICAL (Address Immediately)**
1. **Configure log backups for TestDB** - Database in FULL recovery with no log backups poses data loss risk
2. **Set max server memory** to 4,800 MB to prevent OS starvation

### **🟡 IMPORTANT (Address Soon)**
3. **Tune parallelism settings:**
   - Set MAXDOP = 4 (half of logical CPUs)
   - Set cost threshold for parallelism = 50
4. **Enable "optimize for ad hoc workloads"** to reduce plan cache memory usage
5. **Implement system database backups** (master, model, msdb) - weekly schedule

### **🟢 OPTIONAL (Performance Tuning)**
6. Monitor wait stats after workload increases - current environment is very light
7. Consider adding performance baselines once workload stabilizes

---

## **11. Summary**

**Overall Health: ✅ EXCELLENT**

This SQL Server environment is in excellent health. The Always On Availability Group is fully synchronized with zero data loss exposure. I/O performance is outstanding (all sub-5ms except tempdb). Memory and CPU utilization are healthy with plenty of headroom.

**Key Strengths:**
- Always On AG fully synchronized and healthy
- Excellent I/O performance across all databases
- No blocking, deadlocks, or performance issues detected
- Clean plan cache with no high-variance queries
- Healthy VLF counts and tempdb usage

**Action Items:**
- Implement log backups for TestDB (CRITICAL - prevents log file growth and enables point-in-time recovery)
- Tune max server memory and MAXDOP settings (IMPORTANT - production best practices)
- Add system database backups (IMPORTANT - disaster recovery requirement)

The 50,000-row insert workload completed successfully with excellent performance (15ms avg, 2,173 logical reads per batch). The environment is ready for production workload once backup and configuration items are addressed.

---

## **How This Report Was Generated**

This comprehensive health report was generated using the **sql-mcp-server** with the following MCP tools:

### **Tools Used (20+ DMV-based diagnostics):**
- `list_instances` - Discovered 2 SQL Server instances
- `get_server_info` - Version, edition, CPU, memory, uptime
- `get_database_info` - Database inventory and recovery models
- `get_wait_stats` - Wait statistics analysis
- `get_active_sessions` - Current session activity
- `get_blocking_chains` - Blocking detection
- `get_memory_usage` - Memory clerk breakdown
- `get_backup_status` - Backup compliance check
- `get_ag_health` - Always On Availability Group status
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

### **Generation Method:**
This report was generated by invoking 20+ MCP tools in parallel batches against the SqlServer1 instance. All data is real-time from SQL Server DMVs (Dynamic Management Views). The agent synthesized the results into this structured markdown report.

### **Data Freshness:**
Real-time snapshot captured at **May 25, 2026 12:12 UTC**

---

**Report Generated by:** SQL MCP Server (sql-dba)  
**Repository:** https://github.com/nocentino/sql-mcp-server
