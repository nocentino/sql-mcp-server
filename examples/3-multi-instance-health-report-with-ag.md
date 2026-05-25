# **SQL Server Always On Availability Group - Production Health Report**
### Generated: May 25, 2026 14:30 UTC | Environment: sql-mcp Demo with Active Workload

---

## **Executive Summary**

**Environment:** 2 SQL Server instances with Always On Availability Group  
**AG Status:** ✅ **HEALTHY** - TestAG synchronized with zero data loss  
**Primary Instance (sqlserver1):** ✅ **OPERATIONAL** with active workload  
**Secondary Instance (sqlserver2):** ✅ **SYNCHRONIZED** - real-time replication active  
**Current State:** ⚠️ **BLOCKING DETECTED** - Active blocking chain (3 sessions waiting)  
**Database:** TestDB (1,167 rows) actively replicating across instances

---

## **Always On Availability Group Status**

### **AG Configuration: TestAG**

| Property | Value |
|----------|-------|
| **AG Name** | TestAG |
| **Cluster Type** | NONE (cluster-less, Linux pattern) |
| **Backup Preference** | PRIMARY |
| **Primary Replica** | sqlserver1:5022 (port 1433 for clients) |
| **Secondary Replica** | sqlserver2:5022 (port 1434 for clients) |
| **Availability Mode** | SYNCHRONOUS_COMMIT (zero data loss) |
| **Failover Mode** | MANUAL |
| **Seeding Mode** | AUTOMATIC |
| **Authentication** | Certificate-based (sqlserver1_cert, sqlserver2_cert) |

### **✅ Replication Health - TestDB**

| Metric | Primary (sqlserver1) | Secondary (sqlserver2) | Status |
|--------|---------------------|----------------------|--------|
| **Role** | PRIMARY | SECONDARY | ✅ Expected |
| **Connection State** | CONNECTED | CONNECTED | ✅ Healthy |
| **Sync Health** | HEALTHY | HEALTHY | ✅ Excellent |
| **Sync State** | SYNCHRONIZED | SYNCHRONIZED | ✅ Zero lag |
| **Send Queue** | N/A | 0 MB | ✅ No backlog |
| **Redo Queue** | N/A | 0 MB | ✅ No backlog |
| **Send Rate** | N/A | 33 MB/sec | ✅ Fast |
| **Redo Rate** | N/A | 11 MB/sec | ✅ Fast |
| **Data Loss Risk** | N/A | 0 seconds | ✅ Zero data loss |
| **Recovery Time** | N/A | 0 seconds | ✅ Instant failover |
| **Last Commit** | 14:28:27.417 | 14:28:27.410 | ✅ 7ms lag |
| **Last Hardened** | N/A | 14:28:27.413 | ✅ Committed to disk |

**Analysis:** ✅ **PERFECT REPLICATION HEALTH**  
- Both replicas are CONNECTED and SYNCHRONIZED
- Zero send queue and zero redo queue = no replication lag
- Synchronous commit ensures zero data loss (estimated_data_loss_seconds = 0)
- Last commit time delta is 7ms - excellent synchronization latency
- Secondary is ready for immediate manual failover with no recovery time needed

---

## **⚠️ ACTIVE BLOCKING DETECTED**

### **Blocking Chain Analysis**

**Status:** 🔴 **ACTIVE BLOCKING CHAIN** - 1 blocker, 3 blocked sessions  
**Root Blocker:** Session 77 (holding locks for 18+ seconds)  
**Blocked Workload:** 3 UPDATE statements waiting on LCK_M_X (exclusive lock)

| Blocked SPID | Blocker SPID | Wait Type | Wait Time (sec) | Status | Database | Command |
|--------------|--------------|-----------|-----------------|--------|----------|---------|
| **79** | **77** | LCK_M_X | **18.41** | suspended | TestDB | UPDATE |
| **80** | **79** | LCK_M_X | **17.38** | suspended | TestDB | UPDATE |
| **82** | **79** | LCK_M_X | **16.37** | suspended | TestDB | UPDATE |

### **Blocking Chain Topology**

```
Session 77 (BLOCKER)
   └─ HOLDING: Exclusive lock on TestData row (ID=1)
   └─ DURATION: 18+ seconds
   └─ SQL: BEGIN TRANSACTION; UPDATE TestData ... WAITFOR DELAY '00:02:00'
   └─ STATUS: Active, intentional hold (demo scenario)
      │
      ├─> Session 79 (BLOCKED by 77)
      │      └─ WAITING: 18.41 seconds
      │      └─ SQL: UPDATE TestData SET TestValue ... WHERE ID = 1
      │      │
      │      ├─> Session 80 (BLOCKED by 79)
      │      │      └─ WAITING: 17.38 seconds
      │      │      └─ SQL: UPDATE TestData SET TestValue ... WHERE ID = 1
      │      │
      │      └─> Session 82 (BLOCKED by 79)
      │             └─ WAITING: 16.37 seconds
      │             └─ SQL: UPDATE TestData SET TestValue ... WHERE ID = 1
```

### **Blocking Session Details (Session 77 - Root Blocker)**

| Property | Value |
|----------|-------|
| **Session ID** | 77 |
| **Login** | sa |
| **Host** | sqlserver1 |
| **Program** | SQLCMD |
| **Database** | TestDB |
| **Start Time** | 2026-05-25 14:28:27 UTC |
| **Duration** | 18+ seconds (still running) |

**Blocker SQL:**
```sql
USE TestDB;
BEGIN TRANSACTION;
UPDATE TestData 
SET TestValue = 'BLOCKING SESSION - SPID ' + CAST(@@SPID AS VARCHAR(10)) 
WHERE ID = 1;
WAITFOR DELAY '00:02:00';  -- Intentional 2-minute hold
COMMIT TRANSACTION;
```

### **Impact Assessment**

- 🔴 **3 sessions blocked** waiting for row-level lock
- ⏱️ **18 seconds max wait time** - exceeds typical application timeout thresholds (5-10 sec)
- 🎯 **Lock contention on single row** (ID=1) - hot spot detected
- ⚠️ **Blocking does NOT affect AG replication** - secondary remains synchronized
- ℹ️ **This is a DEMO scenario** - intentional blocking to demonstrate monitoring capabilities

**Recommended Actions (in production):**
1. Identify long-running transaction root cause (Session 77)
2. Consider `KILL 77` if critical business impact
3. Review application retry logic and connection timeout settings
4. Investigate why multiple sessions target same row (potential design issue)
5. Consider optimistic locking patterns (row versioning) if appropriate

---

## **Database Workload - TestDB**

### **Database Overview**

| Property | Value |
|----------|-------|
| **Database Name** | TestDB |
| **Recovery Model** | FULL |
| **State** | ONLINE (on both replicas) |
| **Total Rows** | 1,167 rows in TestData table |
| **Data Size** | ~16 MB (varies with replication overhead) |
| **Availability Group** | TestAG (synchronized across 2 replicas) |
| **Last Activity** | Active workload + blocking scenario running now |

### **Workload Composition**

| Operation | Row Count | Description |
|-----------|-----------|-------------|
| Initial Seed | 5 rows | Created during AG setup |
| Loop Inserts | 162 rows | Partial completion of 1000-row loop |
| Batch Insert | 1,000 rows | Fast bulk insert using system table |
| **Total** | **1,167 rows** | Current row count on primary |

**Replication Status:** ✅ All 1,167 rows successfully synchronized to secondary replica

---

## **Instance Health Summary**

### **Primary: sqlserver1**

| Metric | Value | Status |
|--------|-------|--------|
| **SQL Server Version** | 2025 Enterprise Developer (17.0.4005.7) | ✅ Latest |
| **HADR Enabled** | Yes | ✅ Required for AG |
| **AG Role** | PRIMARY | ✅ Active |
| **CPU Count** | 8 logical processors | ✅ Adequate |
| **Physical Memory** | 6,349 MB total | ✅ Sufficient |
| **Uptime** | ~1.5 hours | ℹ️ Fresh environment |
| **Active Sessions** | 7+ (including 4 blocking-related) | ⚠️ Blocking active |
| **Buffer Pool** | ~114 MB (growing with workload) | ✅ Healthy |

### **Secondary: sqlserver2**

| Metric | Value | Status |
|--------|-------|--------|
| **SQL Server Version** | 2025 Enterprise Developer (17.0.4005.7) | ✅ Latest |
| **HADR Enabled** | Yes | ✅ Required for AG |
| **AG Role** | SECONDARY | ✅ Synchronized |
| **AG Lag** | 0 seconds (SYNCHRONIZED) | ✅ Real-time |
| **Send Queue** | 0 MB | ✅ No backlog |
| **Redo Queue** | 0 MB | ✅ No backlog |
| **Connection State** | CONNECTED | ✅ Healthy |
| **Failover Ready** | Yes (0 sec recovery time) | ✅ Instant |

---

## **Performance Observations**

### **Wait Statistics (sqlserver1 - Primary)**

**Top waits during active workload:**
- **LCK_M_X:** High (due to intentional blocking scenario)
- **WRITELOG:** Increased activity from 1,167 INSERTs and AG replication
- **HADR_SYNC_COMMIT:** Present (synchronous commit to secondary)
- **PAGEIOLATCH_SH:** Moderate (data page reads during workload)

**Analysis:** Wait statistics reflect expected pattern for:
1. Active workload (inserts generating WRITELOG waits)
2. AG synchronous commit (HADR_SYNC_COMMIT - normal for sync mode)
3. Intentional blocking (LCK_M_X - demo scenario)

### **Memory Usage (sqlserver1)**

| Component | Size | Purpose |
|-----------|------|---------|
| **Buffer Pool** | 114 MB | Data cache (increased from 40 MB baseline) |
| **SQL Plans** | 46 MB | Cached query plans |
| **Bound Trees** | 45 MB | Compiled query plans |
| **System** | 3,558 MB free | Healthy available memory |

**Trend:** Buffer pool grew from 40 MB → 114 MB after workload generation (expected behavior)

---

## **Recommendations**

### **🟢 IMMEDIATE ACTIONS**

1. **✅ AG IS HEALTHY** - No action needed for replication
   - Both replicas synchronized with zero lag
   - No send/redo queue buildup
   - Zero estimated data loss

2. **⚠️ RESOLVE BLOCKING** (Demo Scenario)
   - Session 77 will auto-release after WAITFOR DELAY completes
   - In production: investigate root cause and consider KILL if critical

3. **✅ WORKLOAD REPLICATED**
   - All 1,167 rows successfully synchronized to secondary
   - AG automatic seeding working perfectly

### **🔵 CONFIGURATION TUNING** (Same as baseline report)

4. **Set max server memory** on both instances (4,800 MB recommended)
5. **Tune MAXDOP** to 4 (currently unlimited)
6. **Adjust cost threshold for parallelism** to 50 (currently 5)
7. **Enable optimize for ad hoc workloads**

### **🟡 OPERATIONAL READINESS**

8. **Configure AG backup preference**
   - Consider offloading backups to secondary replica
   - Set BACKUP_PRIORITY on replicas

9. **Implement monitoring**
   - Alert on redo_queue_mb > 100 MB
   - Alert on synchronization_health != HEALTHY
   - Alert on blocking > 30 seconds

10. **Test failover scenarios**
    - Manual failover to secondary
    - Validate application reconnection logic
    - Document failover runbook

---

## **AG Setup Success Verification**

### **✅ Setup Completed Successfully**

| Component | Status | Verification |
|-----------|--------|-------------|
| **Certificates** | ✅ Created | sqlserver1_cert, sqlserver2_cert with private keys |
| **Certificate Trust** | ✅ Established | Mutual trust between both instances |
| **Endpoints** | ✅ Running | Hadr_endpoint on port 5022 (both instances) |
| **AG Creation** | ✅ Success | TestAG with CLUSTER_TYPE = NONE |
| **Secondary JOIN** | ✅ Success | Secondary joined with no errors |
| **Database Seeding** | ✅ Success | TestDB automatically seeded to secondary |
| **Synchronization** | ✅ Active | SYNCHRONIZED state with zero lag |
| **Replication Test** | ✅ Passed | 1,167 rows replicated successfully |

### **Key Fixes Applied**

1. **Certificate Permissions:** Fixed `/var/opt/ag-certs` permissions (chmod 777, chown mssql)
2. **Error Visibility:** Removed `/dev/null` redirects to see actual SQL errors
3. **Seeding Mode:** Changed from MANUAL to AUTOMATIC (eliminates backup/restore complexity)
4. **Initial Backup:** Added `BACKUP DATABASE TO DISK = 'NUL'` to properly initialize FULL recovery mode
5. **Cleanup Order:** Drop endpoints before certificates (endpoints lock certificates)
6. **Secondary Cleanup:** Drop AG on secondary before recreating (prevents orphaned state)

---

## **Summary**

### **Overall Status: ✅ HEALTHY WITH ACTIVE WORKLOAD**

**Strengths:**
- ✅ Always On AG fully operational with zero replication lag
- ✅ SYNCHRONIZED state across both replicas (no data loss risk)
- ✅ Automatic seeding working perfectly (1,167 rows replicated)
- ✅ Certificate-based authentication established
- ✅ Both endpoints running and connected
- ✅ Zero redo/send queue (excellent performance)
- ✅ Fast replication rates (33 MB/s send, 11 MB/s redo)
- ✅ Instant failover capability (0 second estimated recovery time)

**Current Issues:**
- ⚠️ Active blocking chain (3 sessions) - **DEMO SCENARIO** for monitoring demonstration
- ⚠️ Configuration tuning still pending (max memory, MAXDOP, CTFP)
- ⚠️ No backup strategy configured

**Environment Readiness:**
- ✅ **High Availability:** AG successfully configured and operational
- ✅ **Replication:** Real-time synchronous replication working
- ✅ **Monitoring:** Blocking detection, AG health monitoring validated
- ⚠️ **Production:** Needs configuration tuning and backup implementation

**Next Steps:**
1. Allow blocking scenario to complete (auto-resolves in 2 minutes)
2. Apply sp_configure tuning on both instances
3. Configure backup strategy leveraging secondary replica
4. Test manual failover to secondary
5. Document operational runbooks

---

## **How This Report Was Generated**

This report was generated using the **sql-mcp-server** multi-instance architecture with real-time data collection during active workload and blocking scenarios.

### **MCP Tools Used:**
- `list_instances` - Discovered 2 SQL Server instances
- `get_ag_health` - AG replication status, sync state, queue metrics
- `get_blocking_chains` - Active blocking detection and chain topology
- `get_active_sessions` - Session monitoring
- `get_server_info` - Instance configuration
- `get_database_info` - Database inventory
- `get_wait_stats` - Performance analysis
- `get_memory_usage` - Memory consumption tracking

### **Data Collection:**
- **Primary (sqlserver1):** Real-time data during active blocking
- **Secondary (sqlserver2):** Real-time AG sync metrics
- **Capture Time:** May 25, 2026 14:30 UTC (during active workload)

### **Workload Scenario:**
1. ✅ Inserted 1,167 rows into TestDB on primary
2. ✅ Started intentional blocker (Session 77, 2-minute hold)
3. ✅ Started 3 blocked sessions (Sessions 79, 80, 82)
4. ✅ Captured blocking chain topology and wait times
5. ✅ Verified AG synchronized all changes to secondary

---

**Report Generated by:** SQL MCP Server (sql-dba)  
**Architecture:** 1 MCP server → 2 SQL Server instances → 1 Availability Group  
**Repository:** https://github.com/nocentino/sql-mcp-server  
**AG Setup Script:** `./scripts/ag/setup-ag.sh`
