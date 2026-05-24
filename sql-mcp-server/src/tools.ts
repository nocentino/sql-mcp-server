import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { queryInstance, listInstances } from "./connectionManager.js";

function toJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  );
}
import { validateQuery } from "./safety.js";

type ToolResult = { content: Array<{ type: "text"; text: string }> };

function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: toJson(value) }] };
}

function err(message: string): ToolResult {
  return { content: [{ type: "text", text: `Error: ${message}` }] };
}

function truncationNote(count: number): string {
  return `\n\n[Note: Result was truncated to ${count} rows. Use a more specific WHERE clause to narrow the result set.]`;
}
// ─────────────────────────────────────────────────────────────────────────────
// Shared instance_name parameter added to every tool.
// Copilot can call list_instances to discover available names.
// ─────────────────────────────────────────────────────────────────────────────
const instanceParam = {
  instance_name: z
    .string()
    .optional()
    .default("SqlServer1")
    .describe(
      "Named SQL Server instance to query. Call list_instances first to see all available instance names."
    ),
};

export function registerTools(server: McpServer): void {

  // ============================================================
  // list_instances — discover available SQL Server instances
  // ============================================================
  server.tool(
    "list_instances",
    "List all configured SQL Server instances available for querying. Call this first when the user does not specify which instance they want, or to verify what instances are registered.",
    {},
    async () =>
      ok(listInstances().map(({ name, host, port, user }) => ({ name, host, port, user })))
  );

  // ============================================================
  // fan_out_query — run any T-SQL across all (or selected) instances in parallel
  // ============================================================
  server.tool(
    "fan_out_query",
    "Run the same read-only T-SQL SELECT statement across all registered SQL Server instances simultaneously (or a specified subset) and return results keyed by instance name. Use this when you want to compare the same metric — wait stats, top queries, blocking — across the whole fleet at once. Failures on individual instances are returned as errors without cancelling the others.",
    {
      query: z
        .string()
        .describe("Read-only T-SQL SELECT statement to execute on every instance."),
      instances: z
        .array(z.string())
        .optional()
        .describe(
          "Subset of instance names to query. Omit to query all registered instances. Call list_instances to see available names."
        ),
    },
    async ({ query: sql, instances: subset }) => {
      const targets = subset?.length
        ? listInstances().filter((i) => subset.includes(i.name))
        : listInstances();

      if (targets.length === 0) {
        return err("No matching instances found. Call list_instances to see available names.");
      }

      const settled = await Promise.allSettled(
        targets.map(async (inst) => {
          const { rows, truncated } = await queryInstance(inst.name, sql, 200);
          return { instance: inst.name, rows, truncated };
        })
      );

      const results: Record<string, unknown> = {};
      let failed = 0;
      for (let i = 0; i < settled.length; i++) {
        const r = settled[i];
        const name = targets[i].name;
        if (r.status === "fulfilled") {
          results[name] = { rows: r.value.rows, truncated: r.value.truncated };
        } else {
          results[name] = { error: r.reason instanceof Error ? r.reason.message : String(r.reason) };
          failed++;
        }
      }

      return ok({
        instances_queried: targets.length,
        instances_failed: failed,
        results,
      });
    }
  );

  // ============================================================
  // execute_query — free-form read-only T-SQL
  // ============================================================
  server.tool(
    "execute_query",
    "Execute a read-only T-SQL SELECT statement. Use this for ad-hoc DMV analysis, custom JOINs across multiple DMVs, CTEs, and CROSS APPLY queries that pre-built tools don't cover. Connects to the master database by default. Only SELECT/WITH/DECLARE statements are allowed.",
    { ...instanceParam,
      query: z
        .string()
        .describe(
          "T-SQL SELECT statement to execute. May include CTEs (WITH ...), CROSS APPLY, sub-queries, etc."
        ),
    },
    async ({ instance_name, query: sql }) => {
      const check = validateQuery(sql);
      if (!check.valid) return err(check.reason!);

      try {
        const { rows, truncated } = await queryInstance(instance_name, sql, 500);
        const note = truncated ? truncationNote(500) : "";
        return { content: [{ type: "text", text: toJson(rows) + note }] };
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_active_sessions
  // ============================================================
  server.tool(
    "get_active_sessions",
    "Get all active SQL Server sessions with current request details, CPU, blocking status, and current SQL text. Best starting point for performance investigations. Uses CROSS APPLY dm_exec_sql_text to fetch the actual query being run.",
    { ...instanceParam,
      include_sleeping: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include sleeping/idle sessions (default: false — active requests only)"),
    },
    async ({ instance_name, include_sleeping }) => {
      const sleepFilter = include_sleeping
        ? ""
        : "AND (r.session_id IS NOT NULL OR s.status NOT IN ('sleeping', 'dormant'))";

      try {
        const { rows, truncated } = await queryInstance(instance_name, `
          SELECT
            s.session_id,
            s.login_name,
            s.host_name,
            s.program_name,
            s.status                                        AS session_status,
            r.status                                        AS request_status,
            r.command,
            r.wait_type,
            r.wait_time                                     AS wait_ms,
            r.blocking_session_id,
            r.total_elapsed_time                            AS elapsed_ms,
            r.cpu_time                                      AS request_cpu_ms,
            s.cpu_time                                      AS session_cpu_ms,
            r.logical_reads                                 AS request_logical_reads,
            s.reads                                         AS session_reads,
            s.writes                                        AS session_writes,
            r.percent_complete,
            DB_NAME(r.database_id)                          AS database_name,
            r.statement_start_offset,
            SUBSTRING(
              t.text,
              (r.statement_start_offset / 2) + 1,
              ((CASE r.statement_end_offset
                  WHEN -1 THEN DATALENGTH(t.text)
                  ELSE r.statement_end_offset
                END - r.statement_start_offset) / 2) + 1
            )                                               AS current_statement,
            s.last_request_start_time,
            s.last_request_end_time
          FROM sys.dm_exec_sessions s
          LEFT JOIN sys.dm_exec_requests r ON s.session_id = r.session_id
          OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
          WHERE s.is_user_process = 1
            ${sleepFilter}
          ORDER BY
            CASE WHEN r.blocking_session_id > 0 THEN 0 ELSE 1 END,
            COALESCE(r.total_elapsed_time, 0) DESC
        `);
        return ok({ sessions: rows, truncated });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_blocking_chains
  // ============================================================
  server.tool(
    "get_blocking_chains",
    "Show all current blocking chains — which sessions are blocked and which session is causing the blockage. Includes the SQL text of both the blocked and blocking session, wait time, and lock details. Returns a message if there is no blocking.",
    { ...instanceParam },
    async ({ instance_name }) => {
      try {
        const { rows } = await queryInstance(instance_name, `
          SELECT
            r.session_id                                    AS blocked_session_id,
            r.blocking_session_id,
            r.wait_type,
            r.wait_time / 1000.0                            AS wait_seconds,
            r.status                                        AS blocked_status,
            r.command                                       AS blocked_command,
            DB_NAME(r.database_id)                          AS database_name,
            s_blocked.login_name                            AS blocked_login,
            s_blocked.host_name                             AS blocked_host,
            s_blocked.program_name                          AS blocked_program,
            SUBSTRING(
              t_blocked.text,
              (r.statement_start_offset / 2) + 1,
              ((CASE r.statement_end_offset
                  WHEN -1 THEN DATALENGTH(t_blocked.text)
                  ELSE r.statement_end_offset
                END - r.statement_start_offset) / 2) + 1
            )                                               AS blocked_statement,
            s_blocker.login_name                            AS blocker_login,
            s_blocker.host_name                             AS blocker_host,
            s_blocker.program_name                          AS blocker_program,
            t_blocker.text                                  AS blocker_sql_text,
            s_blocker.last_request_start_time               AS blocker_last_request_start
          FROM sys.dm_exec_requests r
          JOIN sys.dm_exec_sessions s_blocked
            ON r.session_id = s_blocked.session_id
          LEFT JOIN sys.dm_exec_sessions s_blocker
            ON r.blocking_session_id = s_blocker.session_id
          -- Use dm_exec_connections.most_recent_sql_handle so we can retrieve
          -- the blocker's SQL even when it is sleeping (not in dm_exec_requests).
          -- Source: Brent Ozar First Responder Kit (sp_Blitz.sql)
          LEFT JOIN sys.dm_exec_connections c_blocker
            ON r.blocking_session_id = c_blocker.session_id
          OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t_blocked
          OUTER APPLY sys.dm_exec_sql_text(c_blocker.most_recent_sql_handle) t_blocker
          WHERE r.blocking_session_id > 0
          ORDER BY wait_seconds DESC
        `);

        if (rows.length === 0) {
          return { content: [{ type: "text", text: "No blocking detected at this time." }] };
        }
        return ok({ blocking_chains: rows });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_top_queries
  // ============================================================
  server.tool(
    "get_top_queries",
    "Get the most expensive queries from the plan cache ranked by a resource metric. Use to find the worst offenders for CPU, logical I/O, elapsed time, memory grants, or total executions since the last SQL Server restart.",
    { ...instanceParam,
      order_by: z
        .enum(["cpu", "reads", "writes", "elapsed", "memory", "executions"])
        .default("cpu")
        .describe("Metric to rank by: cpu (worker time), reads (logical reads), writes, elapsed, memory (grant KB), or executions"),
      top_n: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Number of queries to return (default 20, max 100)"),
    },
    async ({ instance_name, order_by, top_n }) => {
      const orderMap: Record<string, string> = {
        cpu:        "qs.total_worker_time DESC",
        reads:      "qs.total_logical_reads DESC",
        writes:     "qs.total_logical_writes DESC",
        elapsed:    "qs.total_elapsed_time DESC",
        memory:     "qs.total_grant_kb DESC",
        executions: "qs.execution_count DESC",
      };

      try {
        const { rows } = await queryInstance(instance_name, `
          SELECT TOP (${top_n})
            qs.execution_count,
            qs.total_worker_time / 1000                     AS total_cpu_ms,
            qs.total_worker_time / qs.execution_count / 1000 AS avg_cpu_ms,
            qs.total_elapsed_time / 1000                    AS total_elapsed_ms,
            qs.total_elapsed_time / qs.execution_count / 1000 AS avg_elapsed_ms,
            qs.total_logical_reads,
            qs.total_logical_reads / qs.execution_count     AS avg_logical_reads,
            qs.total_physical_reads,
            qs.total_logical_writes,
            COALESCE(qs.total_grant_kb, 0)                  AS total_grant_kb,
            COALESCE(qs.total_grant_kb / NULLIF(qs.execution_count, 0), 0) AS avg_grant_kb,
            COALESCE(qs.total_rows / NULLIF(qs.execution_count, 0), 0)     AS avg_rows,
            DB_NAME(t.dbid)                                 AS database_name,
            OBJECT_NAME(t.objectid, t.dbid)                 AS object_name,
            qs.creation_time,
            qs.last_execution_time,
            SUBSTRING(
              t.text,
              (qs.statement_start_offset / 2) + 1,
              ((CASE qs.statement_end_offset
                  WHEN -1 THEN DATALENGTH(t.text)
                  ELSE qs.statement_end_offset
                END - qs.statement_start_offset) / 2) + 1
            )                                               AS query_text
          FROM sys.dm_exec_query_stats qs
          OUTER APPLY sys.dm_exec_sql_text(qs.sql_handle) t
          WHERE t.text IS NOT NULL
          ORDER BY ${orderMap[order_by]}
        `);
        return ok({ top_queries: rows, ordered_by: order_by });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_wait_stats
  // ============================================================
  server.tool(
    "get_wait_stats",
    "Get cumulative wait statistics since the last SQL Server restart (or last DBCC SQLPERF('sys.dm_os_wait_stats', CLEAR)). Shows where SQL Server spends its time waiting. Key signals: PAGEIOLATCH_* = disk I/O pressure; LCK_* = lock contention; CXPACKET/CXCONSUMER = parallelism; SOS_SCHEDULER_YIELD = CPU pressure; RESOURCE_SEMAPHORE = memory grants.",
    { ...instanceParam,
      exclude_benign: z
        .boolean()
        .default(true)
        .describe("Exclude known idle/background waits to focus on actionable waits (default: true)"),
    },
    async ({ instance_name, exclude_benign }) => {
      // Source: Brent Ozar First Responder Kit (sp_Blitz.sql, #IgnorableWaits)
      const benignList = [
        // Sleep / idle background tasks
        "SLEEP_TASK", "SLEEP_SYSTEMTASK", "SLEEP_DBSTARTUP", "SLEEP_DBTASK",
        "SLEEP_TEMPDBSTARTUP", "SLEEP_MASTERDBREADY", "SLEEP_MASTERMDREADY",
        "SLEEP_MASTERUPGRADED", "SLEEP_MSDBSTARTUP", "SLEEP_REPLICATION_MONITOR",
        // Service Broker background threads
        "BROKER_EVENTHANDLER", "BROKER_RECEIVE_WAITFOR", "BROKER_TASK_STOP",
        "BROKER_TO_FLUSH", "BROKER_TRANSMITTER",
        // Checkpoint / CLR
        "CHECKPOINT_QUEUE",
        "CLR_AUTO_EVENT", "CLR_MANUAL_EVENT", "CLR_SEMAPHORE",
        // Database mirroring background threads
        "DBMIRROR_DBM_EVENT", "DBMIRROR_DBM_MUTEX", "DBMIRROR_EVENTS_QUEUE",
        "DBMIRROR_WORKER_QUEUE", "DBMIRRORING_CMD",
        // Miscellaneous background
        "DIRTY_PAGE_POLL", "DISPATCHER_QUEUE_SEMAPHORE",
        // Full-text
        "FT_IFTS_SCHEDULER_IDLE_WAIT", "FT_IFTSHC_MUTEX",
        // Always On / HADR background threads
        "HADR_CLUSAPI_CALL", "HADR_FABRIC_CALLBACK",
        "HADR_FILESTREAM_IOMGR_IOCOMPLETION", "HADR_LOGCAPTURE_WAIT",
        "HADR_WORK_QUEUE",
        // Lazy writer, log manager
        "LAZYWRITER_SLEEP", "LOGMGR_QUEUE",
        // On-demand / task queue
        "ONDEMAND_TASK_QUEUE",
        // Parallel redo (AG / log apply threads)
        "PARALLEL_REDO_DRAIN_WORKER", "PARALLEL_REDO_LOG_CACHE",
        "PARALLEL_REDO_TRAN_LIST", "PARALLEL_REDO_TRAN_TURN",
        "PARALLEL_REDO_WORKER_SYNC", "PARALLEL_REDO_WORKER_WAIT_WORK",
        "POPULATE_LOCK_ORDINALS",
        // Preemptive OS / HADR
        "PREEMPTIVE_HADR_LEASE_MECHANISM", "PREEMPTIVE_OS_FLUSHFILEBUFFERS",
        "PREEMPTIVE_SP_SERVER_DIAGNOSTICS",
        // Persistent Version Store / extensibility
        "PVS_PREALLOCATE", "PWAIT_EXTENSIBILITY_CLEANUP_TASK",
        // Query Data Store background threads
        "QDS_ASYNC_QUEUE",
        "QDS_CLEANUP_STALE_QUERIES_TASK_MAIN_LOOP_SLEEP",
        "QDS_PERSIST_TASK_MAIN_LOOP_SLEEP", "QDS_SHUTDOWN_QUEUE",
        // Redo / deadlock detection
        "REDO_THREAD_PENDING_WORK", "REQUEST_FOR_DEADLOCK_SEARCH",
        // Misc background
        "RESOURCE_QUEUE", "SERVER_IDLE_CHECK", "SNI_HTTP_ACCEPT",
        "SOS_WORK_DISPATCHER", "SP_SERVER_DIAGNOSTICS_SLEEP",
        // SQL Trace
        "SQLTRACE_BUFFER_FLUSH", "SQLTRACE_INCREMENTAL_FLUSH_SLEEP",
        // UCS / XTP
        "UCS_SESSION_REGISTRATION",
        "WAIT_XTP_OFFLINE_CKPT_NEW_LOG",
        // Explicit WAITFOR statements (application-level sleeps)
        "WAITFOR",
        // Extended Events background
        "XE_DISPATCHER_WAIT", "XE_LIVE_TARGET_TVF", "XE_TIMER_EVENT",
      ];

      const benignFilter = exclude_benign
        ? `AND wait_type NOT IN (${benignList.map((w) => `'${w}'`).join(", ")})`
        : "";

      try {
        const { rows } = await queryInstance(instance_name, `
          SELECT
            wait_type,
            waiting_tasks_count,
            wait_time_ms,
            max_wait_time_ms,
            signal_wait_time_ms,
            wait_time_ms - signal_wait_time_ms              AS resource_wait_time_ms,
            CAST(
              100.0 * wait_time_ms / NULLIF(SUM(wait_time_ms) OVER (), 0)
            AS DECIMAL(6, 2))                               AS pct_total
          FROM sys.dm_os_wait_stats
          WHERE wait_time_ms > 0
            ${benignFilter}
          ORDER BY wait_time_ms DESC
        `);
        return ok({ wait_stats: rows, benign_waits_excluded: exclude_benign });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_file_io_stats
  // ============================================================
  server.tool(
    "get_file_io_stats",
    "Get I/O statistics for all database files including average read and write latency. Latency thresholds: < 5 ms excellent, 5–20 ms good, 20–50 ms acceptable, > 50 ms concerning, > 100 ms critical. Also shows available free space on each volume.",
    { ...instanceParam },
    async ({ instance_name }) => {
      try {
        const { rows } = await queryInstance(instance_name, `
          SELECT
            DB_NAME(f.database_id)                          AS database_name,
            f.file_id,
            f.name                                          AS logical_name,
            f.type_desc                                     AS file_type,
            f.physical_name,
            io.num_of_reads,
            io.num_of_bytes_read / 1048576                  AS mb_read,
            io.io_stall_read_ms,
            CASE WHEN io.num_of_reads > 0
                 THEN io.io_stall_read_ms / io.num_of_reads
                 ELSE 0 END                                 AS avg_read_latency_ms,
            io.num_of_writes,
            io.num_of_bytes_written / 1048576               AS mb_written,
            io.io_stall_write_ms,
            CASE WHEN io.num_of_writes > 0
                 THEN io.io_stall_write_ms / io.num_of_writes
                 ELSE 0 END                                 AS avg_write_latency_ms,
            io.io_stall,
            io.size_on_disk_bytes / 1048576                 AS size_on_disk_mb,
            v.volume_mount_point,
            v.available_bytes / 1073741824                  AS volume_available_gb,
            CAST(100.0 * v.available_bytes / v.total_bytes AS DECIMAL(5, 1)) AS volume_free_pct
          FROM sys.master_files f
          CROSS APPLY sys.dm_io_virtual_file_stats(f.database_id, f.file_id) io
          CROSS APPLY sys.dm_os_volume_stats(f.database_id, f.file_id) v
          ORDER BY io.io_stall DESC
        `);
        return ok({ file_io_stats: rows });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_cpu_history
  // ============================================================
  server.tool(
    "get_cpu_history",
    "Get SQL Server CPU utilization history from the ring buffer (last ~256 minutes, sampled every ~60 seconds). Shows sql_cpu_pct, system_idle_pct, and other_process_cpu_pct. Use to detect CPU spikes and determine if SQL Server or OS processes are the culprit.",
    { ...instanceParam },
    async ({ instance_name }) => {
      try {
        const { rows } = await queryInstance(instance_name, `
          SELECT TOP 256
            ROW_NUMBER() OVER (ORDER BY r.timestamp DESC)   AS sample_num,
            DATEADD(
              ms,
              -1 * (
                sys_info.ms_ticks
                - CAST(r.timestamp AS BIGINT)
              ),
              GETDATE()
            )                                               AS approx_utc_time,
            r.record.value(
              '(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]',
              'int'
            )                                               AS sql_cpu_pct,
            r.record.value(
              '(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]',
              'int'
            )                                               AS system_idle_pct,
            -- On Linux, SystemIdle is always reported as 0 (the kernel does not
            -- populate it in the ring buffer).  In that case other_process_cpu_pct
            -- cannot be computed and is returned as NULL to avoid a misleading value.
            CASE WHEN r.record.value(
                   '(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]',
                   'int'
                 ) > 0
            THEN 100
                 - r.record.value(
                     '(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]',
                     'int'
                   )
                 - r.record.value(
                     '(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]',
                     'int'
                   )
            ELSE NULL
            END                                             AS other_process_cpu_pct
          FROM (
            SELECT
              timestamp,
              CAST(record AS XML) AS record
            FROM sys.dm_os_ring_buffers
            WHERE ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR'
              AND record LIKE '%<ProcessUtilization>%'
          ) r
          CROSS JOIN sys.dm_os_sys_info AS sys_info
          ORDER BY r.timestamp DESC
        `);
        return ok({ cpu_history: rows });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_memory_usage
  // ============================================================
  server.tool(
    "get_memory_usage",
    "Get SQL Server memory breakdown: overall system memory availability, top memory consumers by clerk (MEMORYCLERK_SQLBUFFERPOOL = buffer pool, OBJECTSTORE_LOCK_MANAGER = lock memory, etc.), and query memory grant semaphore status (waiter_count > 0 means memory grant pressure).",
    { ...instanceParam },
    async ({ instance_name }) => {
      try {
        const [systemResult, clerksResult, semaphoresResult] = await Promise.all([
          queryInstance(instance_name, `
            SELECT
              total_physical_memory_kb / 1024     AS total_physical_mb,
              available_physical_memory_kb / 1024 AS available_physical_mb,
              total_page_file_kb / 1024           AS total_page_file_mb,
              available_page_file_kb / 1024       AS available_page_file_mb,
              system_memory_state_desc
            FROM sys.dm_os_sys_memory
          `),
          queryInstance(instance_name, `
            SELECT TOP 30
              type,
              name,
              pages_kb,
              virtual_memory_reserved_kb,
              virtual_memory_committed_kb,
              shared_memory_committed_kb
            FROM sys.dm_os_memory_clerks
            WHERE pages_kb > 0
            ORDER BY pages_kb DESC
          `),
          queryInstance(instance_name, `
            SELECT
              resource_semaphore_id,
              pool_id,
              target_memory_kb / 1024             AS target_memory_mb,
              available_memory_kb / 1024          AS available_memory_mb,
              granted_memory_kb / 1024            AS granted_memory_mb,
              used_memory_kb / 1024               AS used_memory_mb,
              grantee_count,
              waiter_count,
              timeout_error_count
            FROM sys.dm_exec_query_resource_semaphores
          `),
        ]);

        return ok({
          system_memory:       systemResult.rows,
          top_memory_clerks:   clerksResult.rows,
          resource_semaphores: semaphoresResult.rows,
        });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_tempdb_usage
  // ============================================================
  server.tool(
    "get_tempdb_usage",
    "Get TempDB space pressure: file allocation summary and the top sessions by TempDB consumption (internal objects = sorts/hashes/spills; user objects = temp tables/table variables). Use when you see PAGELATCH_* or tempdb contention.",
    { ...instanceParam },
    async ({ instance_name }) => {
      try {
        const [filesResult, sessionsResult] = await Promise.all([
          queryInstance(instance_name, `
            SELECT
              file_id,
              total_page_count * 8 / 1024                   AS total_mb,
              allocated_extent_page_count * 8 / 1024        AS allocated_mb,
              unallocated_extent_page_count * 8 / 1024      AS free_mb,
              version_store_reserved_page_count * 8 / 1024  AS version_store_mb,
              user_object_reserved_page_count * 8 / 1024    AS user_objects_mb,
              internal_object_reserved_page_count * 8 / 1024 AS internal_objects_mb
            FROM sys.dm_db_file_space_usage
          `),
          queryInstance(instance_name, `
            SELECT TOP 20
              ss.session_id,
              s.login_name,
              s.host_name,
              s.program_name,
              (ss.user_objects_alloc_page_count
               - ss.user_objects_dealloc_page_count) * 8    AS user_objects_net_kb,
              (ss.internal_objects_alloc_page_count
               - ss.internal_objects_dealloc_page_count) * 8 AS internal_objects_net_kb,
              ss.user_objects_alloc_page_count * 8          AS user_objects_alloc_total_kb,
              ss.internal_objects_alloc_page_count * 8      AS internal_objects_alloc_total_kb
            FROM sys.dm_db_session_space_usage ss
            JOIN sys.dm_exec_sessions s ON ss.session_id = s.session_id
            WHERE ss.user_objects_alloc_page_count
                + ss.internal_objects_alloc_page_count > 0
            ORDER BY
              (ss.user_objects_alloc_page_count
               + ss.internal_objects_alloc_page_count) DESC
          `),
        ]);

        return ok({
          file_space:   filesResult.rows,
          top_sessions: sessionsResult.rows,
        });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_database_info
  // ============================================================
  server.tool(
    "get_database_info",
    "Get all SQL Server databases with state, recovery model, compatibility level, data/log file sizes, and log reuse wait reason. Use for capacity planning, identifying databases in SIMPLE recovery that should be FULL, or spotting databases not in a normal state.",
    { ...instanceParam },
    async ({ instance_name }) => {
      try {
        const { rows } = await queryInstance(instance_name, `
          SELECT
            d.database_id,
            d.name,
            d.state_desc,
            d.recovery_model_desc,
            d.compatibility_level,
            d.is_read_only,
            d.is_auto_close_on,
            d.is_auto_shrink_on,
            d.log_reuse_wait_desc,
            SUM(CAST(f.size AS BIGINT)) * 8 / 1024          AS total_size_mb,
            SUM(CASE WHEN f.type = 0
                     THEN CAST(f.size AS BIGINT) ELSE 0 END) * 8 / 1024 AS data_mb,
            SUM(CASE WHEN f.type = 1
                     THEN CAST(f.size AS BIGINT) ELSE 0 END) * 8 / 1024 AS log_mb,
            COUNT(f.file_id)                                AS file_count,
            d.create_date
          FROM sys.databases d
          LEFT JOIN sys.master_files f ON d.database_id = f.database_id
          GROUP BY
            d.database_id, d.name, d.state_desc, d.recovery_model_desc,
            d.compatibility_level, d.is_read_only, d.is_auto_close_on,
            d.is_auto_shrink_on, d.log_reuse_wait_desc, d.create_date
          ORDER BY d.name
        `);
        return ok({ databases: rows });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_server_info
  // ============================================================
  server.tool(
    "get_server_info",
    "Get SQL Server instance details: version, edition, hardware (CPU count, physical memory), uptime, and key sp_configure settings (max server memory, MAXDOP, CTFP). Good first call to establish the environment before deeper investigation.",
    { ...instanceParam },
    async ({ instance_name }) => {
      try {
        const [propsResult, configResult, sysInfoResult] = await Promise.all([
          queryInstance(instance_name, `
            SELECT
              CAST(SERVERPROPERTY('ProductVersion')    AS NVARCHAR(50)) AS product_version,
              CAST(SERVERPROPERTY('ProductLevel')      AS NVARCHAR(50)) AS product_level,
              CAST(SERVERPROPERTY('Edition')           AS NVARCHAR(256)) AS edition,
              CAST(SERVERPROPERTY('EngineEdition')     AS INT)           AS engine_edition,
              CAST(SERVERPROPERTY('ServerName')        AS NVARCHAR(256)) AS server_name,
              CAST(SERVERPROPERTY('Collation')         AS NVARCHAR(256)) AS collation,
              CAST(SERVERPROPERTY('IsHadrEnabled')     AS INT)           AS is_hadr_enabled,
              CAST(SERVERPROPERTY('IsClustered')       AS INT)           AS is_clustered
          `),
          queryInstance(instance_name, `
            SELECT
              name,
              CAST(value_in_use AS NVARCHAR(256)) AS current_value,
              description
            FROM sys.configurations
            WHERE name IN (
              'max server memory (MB)', 'min server memory (MB)',
              'max degree of parallelism', 'cost threshold for parallelism',
              'optimize for ad hoc workloads', 'max worker threads',
              'remote admin connections'
            )
            ORDER BY name
          `),
          queryInstance(instance_name, `
            SELECT
              cpu_count,
              hyperthread_ratio,
              cpu_count / hyperthread_ratio           AS physical_cpus,
              physical_memory_kb / 1024               AS physical_memory_mb,
              virtual_machine_type_desc,
              sqlserver_start_time,
              DATEDIFF(HOUR, sqlserver_start_time, GETDATE()) AS uptime_hours,
              committed_kb / 1024                     AS sql_committed_mb,
              committed_target_kb / 1024              AS sql_target_mb
            FROM sys.dm_os_sys_info
          `),
        ]);

        return ok({
          server_properties:  propsResult.rows,
          key_configurations: configResult.rows,
          system_info:        sysInfoResult.rows,
        });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_missing_indexes
  // ============================================================
  server.tool(
    "get_missing_indexes",
    "Get missing index recommendations from the query optimizer. impact_score = user_seeks × avg_user_impact. High impact_score with many seeks = strong candidate. The suggested_create_index column contains a ready-to-use CREATE INDEX statement. Always test index additions in a non-production environment first.",
    { ...instanceParam,
      min_impact: z
        .number()
        .min(0)
        .max(100)
        .default(50)
        .describe("Minimum avg_user_impact % threshold (default 50)"),
      top_n: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
        .describe("Number of recommendations to return (default 20)"),
    },
    async ({ instance_name, min_impact, top_n }) => {
      try {
        const { rows } = await queryInstance(instance_name, `
          SELECT TOP (${top_n})
            DB_NAME(mid.database_id)                        AS database_name,
            OBJECT_NAME(mid.object_id, mid.database_id)     AS table_name,
            mid.equality_columns,
            mid.inequality_columns,
            mid.included_columns,
            migs.unique_compiles,
            migs.user_seeks,
            migs.user_scans,
            migs.last_user_seek,
            migs.last_user_scan,
            CAST(migs.avg_user_impact AS DECIMAL(5, 1))     AS avg_user_impact_pct,
            CAST(migs.avg_total_user_cost AS DECIMAL(18, 4)) AS avg_total_user_cost,
            -- Source: Brent Ozar First Responder Kit (sp_BlitzIndex.sql), "magic_benefit_number"
            CAST(migs.user_seeks * migs.avg_total_user_cost * (migs.avg_user_impact / 100.0) AS DECIMAL(18, 2)) AS impact_score,
            'CREATE INDEX [IX_'
              + OBJECT_NAME(mid.object_id, mid.database_id)
              + '_missing_'
              + CAST(mig.index_group_handle AS VARCHAR(20))
              + '] ON '
              + mid.statement
              + ' ('
              + ISNULL(mid.equality_columns, '')
              + CASE
                  WHEN mid.equality_columns IS NOT NULL
                   AND mid.inequality_columns IS NOT NULL THEN ','
                  ELSE ''
                END
              + ISNULL(mid.inequality_columns, '')
              + ')'
              + ISNULL(' INCLUDE (' + mid.included_columns + ')', '')
                                                            AS suggested_create_index
          FROM sys.dm_db_missing_index_groups mig
          JOIN sys.dm_db_missing_index_group_stats migs
            ON mig.index_group_handle = migs.group_handle
          JOIN sys.dm_db_missing_index_details mid
            ON mig.index_handle = mid.index_handle
          WHERE migs.avg_user_impact >= ${min_impact}
          ORDER BY impact_score DESC
        `);

        if (rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No missing index recommendations with avg_user_impact >= ${min_impact}%.`,
              },
            ],
          };
        }
        return ok({ missing_indexes: rows });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_index_usage_stats
  // ============================================================
  server.tool(
    "get_index_usage_stats",
    "Get index usage statistics (seeks, scans, lookups, updates) since the last SQL Server restart. Use to find unused indexes (high updates, zero reads = write overhead with no read benefit — candidates for removal) and heavily-scanned indexes (candidates for covering index improvements).",
    { ...instanceParam,
      database_name: z
        .string()
        .optional()
        .describe("Filter to a specific database name (default: all user databases)"),
      include_unused: z
        .boolean()
        .default(true)
        .describe("Include indexes with zero reads — shows unused index candidates (default: true)"),
    },
    async ({ instance_name, database_name, include_unused }) => {
      // sys.indexes is a per-database catalog view. From master context it only returns
      // master's indexes; any user-DB rows in dm_db_index_usage_stats either get dropped
      // (no matching object_id in master) or return wrong index metadata (accidental
      // object_id collision). Fix: execute per-database via sp_executesql so sys.indexes
      // resolves in the correct DB context.
      const dbWhere = database_name
        ? `WHERE name = N'${database_name.replace(/'/g, "''")}' AND state = 0`
        : "WHERE database_id > 4 AND state = 0 AND is_read_only = 0";
      const usageFilter = include_unused
        ? ""
        : "AND (ius.user_seeks + ius.user_scans + ius.user_lookups) > 0";

      try {
        const { rows, truncated } = await queryInstance(instance_name, `
          IF OBJECT_ID('tempdb..#idx_usage') IS NOT NULL DROP TABLE #idx_usage;
          CREATE TABLE #idx_usage (
            database_name    NVARCHAR(128),
            table_name       NVARCHAR(256),
            index_name       NVARCHAR(256),
            index_type       NVARCHAR(60),
            user_seeks       BIGINT,
            user_scans       BIGINT,
            user_lookups     BIGINT,
            user_updates     BIGINT,
            total_reads      BIGINT,
            last_user_seek   DATETIME,
            last_user_scan   DATETIME,
            last_user_lookup DATETIME,
            last_user_update DATETIME,
            status           NVARCHAR(20)
          );

          DECLARE @db        NVARCHAR(128);
          DECLARE @inner_sql NVARCHAR(MAX) = N'
            INSERT INTO #idx_usage
            SELECT
              DB_NAME()                           AS database_name,
              OBJECT_NAME(ius.object_id)          AS table_name,
              i.name                              AS index_name,
              i.type_desc                         AS index_type,
              ius.user_seeks,
              ius.user_scans,
              ius.user_lookups,
              ius.user_updates,
              ius.user_seeks + ius.user_scans
                + ius.user_lookups               AS total_reads,
              ius.last_user_seek,
              ius.last_user_scan,
              ius.last_user_lookup,
              ius.last_user_update,
              CASE
                WHEN ius.user_updates > 0
                 AND (ius.user_seeks + ius.user_scans + ius.user_lookups) = 0
                THEN ''UNUSED_INDEX''
                ELSE ''USED''
              END                                AS status
            FROM sys.dm_db_index_usage_stats ius
            JOIN sys.indexes i
              ON ius.object_id = i.object_id
             AND ius.index_id  = i.index_id
            WHERE ius.database_id = DB_ID()
              AND i.name IS NOT NULL
              ${usageFilter}';

          DECLARE db_cur CURSOR LOCAL FAST_FORWARD FOR
            SELECT name FROM sys.databases ${dbWhere};
          OPEN db_cur;
          FETCH NEXT FROM db_cur INTO @db;
          WHILE @@FETCH_STATUS = 0
          BEGIN
            DECLARE @full_sql NVARCHAR(MAX) = N'USE [' + @db + N']; ' + @inner_sql;
            BEGIN TRY
              EXEC sp_executesql @full_sql;
            END TRY
            BEGIN CATCH
              -- Skip inaccessible databases
            END CATCH;
            FETCH NEXT FROM db_cur INTO @db;
          END;
          CLOSE db_cur; DEALLOCATE db_cur;

          SELECT * FROM #idx_usage
          ORDER BY
            CASE WHEN (user_seeks + user_scans + user_lookups) = 0 THEN 0 ELSE 1 END,
            user_updates DESC;
          DROP TABLE #idx_usage;
        `, 1000);
        const note = truncated ? truncationNote(1000) : "";
        return { content: [{ type: "text", text: toJson({ index_usage_stats: rows }) + note }] };
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_database_files
  // ============================================================
  server.tool(
    "get_database_files",
    "Get detailed information about all database files (data and log) including size, growth settings, physical location, and space usage. Use for capacity planning, identifying autogrow/shrink settings that need tuning, or finding files on slow storage.",
    { ...instanceParam,
      database_name: z
        .string()
        .optional()
        .describe("Filter to a specific database name (default: all databases)"),
    },
    async ({ instance_name, database_name }) => {
      const dbFilter = database_name
        ? `AND DB_NAME(mf.database_id) = '${database_name.replace(/'/g, "''")}'`
        : "";

      try {
        const { rows } = await queryInstance(instance_name, `
          SELECT
            DB_NAME(mf.database_id)                         AS database_name,
            mf.file_id,
            mf.name                                         AS logical_name,
            mf.type_desc                                    AS file_type,
            mf.physical_name,
            mf.state_desc,
            mf.size * 8 / 1024                              AS size_mb,
            CASE mf.max_size
              WHEN -1 THEN 'Unlimited'
              WHEN 268435456 THEN 'Unlimited'
              ELSE CAST(mf.max_size * 8 / 1024 AS VARCHAR(20)) + ' MB'
            END                                             AS max_size,
            CASE mf.is_percent_growth
              WHEN 1 THEN CAST(mf.growth AS VARCHAR(10)) + '%'
              ELSE CAST(mf.growth * 8 / 1024 AS VARCHAR(10)) + ' MB'
            END                                             AS growth_setting,
            mf.is_read_only
          FROM sys.master_files mf
          WHERE 1=1
            ${dbFilter}
          ORDER BY
            DB_NAME(mf.database_id),
            mf.type_desc DESC,
            mf.file_id
        `);
        return ok({ database_files: rows });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_query_store_regressions
  // ============================================================
  server.tool(
    "get_query_store_regressions",
    "Get queries with plan regressions detected by Query Store (queries where a plan change caused performance degradation). Only works if Query Store is enabled on the database. Shows queries with forced plans, multiple plans per query, and significant performance differences between plans.",
    { ...instanceParam,
      database_name: z
        .string()
        .describe("Database name to query (Query Store is per-database)"),
      min_regression_pct: z
        .number()
        .min(0)
        .default(50)
        .describe("Minimum performance regression % to report (default: 50%)"),
      top_n: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
        .describe("Number of regressions to return (default: 20)"),
    },
    async ({ instance_name, database_name, min_regression_pct, top_n }) => {
      const dbNameEscaped = database_name.replace(/'/g, "''");
      try {
        const { rows } = await queryInstance(instance_name, `
          USE [${dbNameEscaped}];
          
          WITH PlanStats AS (
            SELECT
              q.query_id,
              q.object_id,
              qp.plan_id,
              qp.is_forced_plan,
              TRY_CAST(qp.query_plan AS XML)              AS query_plan_xml,
              rs.last_execution_time,
              rs.count_executions,
              rs.avg_duration / 1000.0                    AS avg_duration_ms,
              rs.avg_cpu_time / 1000.0                    AS avg_cpu_ms,
              rs.avg_logical_io_reads,
              ROW_NUMBER() OVER (
                PARTITION BY q.query_id
                ORDER BY rs.last_execution_time DESC
              )                                           AS plan_recency_rank,
              ROW_NUMBER() OVER (
                PARTITION BY q.query_id
                ORDER BY rs.avg_duration DESC
              )                                           AS plan_slowest_rank
            FROM sys.query_store_query q
            JOIN sys.query_store_plan qp ON q.query_id = qp.query_id
            JOIN sys.query_store_runtime_stats rs ON qp.plan_id = rs.plan_id
            WHERE rs.last_execution_time >= DATEADD(DAY, -7, GETDATE())
          ),
          Regressions AS (
            SELECT
              recent.query_id,
              recent.plan_id                              AS recent_plan_id,
              recent.is_forced_plan,
              recent.last_execution_time                  AS recent_last_exec,
              recent.avg_duration_ms                      AS recent_avg_duration_ms,
              recent.avg_cpu_ms                           AS recent_avg_cpu_ms,
              best.plan_id                                AS best_plan_id,
              best.avg_duration_ms                        AS best_avg_duration_ms,
              best.avg_cpu_ms                             AS best_avg_cpu_ms,
              CAST(
                100.0 * (recent.avg_duration_ms - best.avg_duration_ms)
                / NULLIF(best.avg_duration_ms, 0)
              AS DECIMAL(10, 1))                          AS regression_pct,
              recent.count_executions,
              recent.avg_logical_io_reads
            FROM PlanStats recent
            CROSS APPLY (
              SELECT TOP 1 *
              FROM PlanStats best
              WHERE best.query_id = recent.query_id
                AND best.plan_id <> recent.plan_id
              ORDER BY best.avg_duration_ms ASC
            ) best
            WHERE recent.plan_recency_rank = 1
              AND recent.avg_duration_ms > best.avg_duration_ms * (1 + ${min_regression_pct} / 100.0)
          )
          SELECT TOP (${top_n})
            r.query_id,
            OBJECT_NAME(q.object_id)                      AS object_name,
            qt.query_sql_text,
            r.recent_plan_id,
            r.best_plan_id,
            r.regression_pct,
            r.recent_avg_duration_ms,
            r.best_avg_duration_ms,
            r.recent_avg_cpu_ms,
            r.best_avg_cpu_ms,
            r.avg_logical_io_reads,
            r.count_executions                            AS recent_plan_executions,
            r.is_forced_plan,
            r.recent_last_exec,
            q.is_internal_query
          FROM Regressions r
          JOIN sys.query_store_query q ON r.query_id = q.query_id
          JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
          ORDER BY r.regression_pct DESC;
          USE master;
        `);

        if (rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No Query Store regressions found in database '${database_name}' with >= ${min_regression_pct}% degradation. Either Query Store is disabled, or there are no significant regressions in the last 7 days.`,
              },
            ],
          };
        }
        return ok({ query_store_regressions: rows, database: database_name });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_plan_cache_pollution
  // ============================================================
  server.tool(
    "get_plan_cache_pollution",
    "Identify plan cache pollution: single-use plans that waste memory, and queries with high execution time variance (parameter sniffing candidates). Single-use plans indicate missing parameterization or ad-hoc queries. High variance (max_elapsed >> min_elapsed) suggests plan reuse with bad parameter values.",
    { ...instanceParam,
      analysis_type: z
        .enum(["single_use", "high_variance", "both"])
        .default("both")
        .describe("Type of pollution to analyze: single_use plans, high_variance queries, or both"),
      top_n: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(30)
        .describe("Number of results to return per category (default: 30)"),
    },
    async ({ instance_name, analysis_type, top_n }) => {
      try {
        const results: Record<string, unknown> = {};

        if (analysis_type === "single_use" || analysis_type === "both") {
          const { rows: singleUse } = await queryInstance(instance_name, `
            SELECT TOP (${top_n})
              DB_NAME(t.dbid)                             AS database_name,
              OBJECT_NAME(t.objectid, t.dbid)             AS object_name,
              cp.size_in_bytes / 1024                     AS plan_size_kb,
              qs.creation_time,
              SUBSTRING(
                t.text,
                (qs.statement_start_offset / 2) + 1,
                ((CASE qs.statement_end_offset
                    WHEN -1 THEN DATALENGTH(t.text)
                    ELSE qs.statement_end_offset
                  END - qs.statement_start_offset) / 2) + 1
              )                                           AS query_text
            FROM sys.dm_exec_cached_plans cp
            JOIN sys.dm_exec_query_stats qs ON cp.plan_handle = qs.plan_handle
            OUTER APPLY sys.dm_exec_sql_text(qs.sql_handle) t
            WHERE cp.usecounts = 1
              AND cp.objtype = 'Adhoc'
            ORDER BY cp.size_in_bytes DESC
          `);
          results.single_use_plans = singleUse;
        }

        if (analysis_type === "high_variance" || analysis_type === "both") {
          const { rows: highVariance } = await queryInstance(instance_name, `
            SELECT TOP (${top_n})
              DB_NAME(t.dbid)                             AS database_name,
              OBJECT_NAME(t.objectid, t.dbid)             AS object_name,
              qs.execution_count,
              qs.min_elapsed_time / 1000                  AS min_elapsed_ms,
              qs.max_elapsed_time / 1000                  AS max_elapsed_ms,
              (qs.max_elapsed_time - qs.min_elapsed_time) / 1000 AS elapsed_variance_ms,
              CAST(
                CASE WHEN qs.min_elapsed_time > 0
                  THEN CAST(qs.max_elapsed_time AS FLOAT) / qs.min_elapsed_time
                  ELSE 0
                END
              AS DECIMAL(10, 1))                          AS variance_ratio,
              qs.total_worker_time / 1000                 AS total_cpu_ms,
              qs.total_logical_reads,
              qs.last_execution_time,
              qs.creation_time,
              SUBSTRING(
                t.text,
                (qs.statement_start_offset / 2) + 1,
                ((CASE qs.statement_end_offset
                    WHEN -1 THEN DATALENGTH(t.text)
                    ELSE qs.statement_end_offset
                  END - qs.statement_start_offset) / 2) + 1
              )                                           AS query_text
            FROM sys.dm_exec_query_stats qs
            OUTER APPLY sys.dm_exec_sql_text(qs.sql_handle) t
            WHERE qs.execution_count >= 10
              AND qs.min_elapsed_time > 0
              -- Source: Brent Ozar First Responder Kit (sp_BlitzCache.sql), parameter sniffing detection
              AND qs.max_elapsed_time >= 1000
              AND CAST(qs.max_elapsed_time AS FLOAT) / qs.min_elapsed_time >= 10
            ORDER BY
              (qs.max_elapsed_time - qs.min_elapsed_time) * qs.execution_count DESC
          `);
          results.high_variance_queries = highVariance;
        }

        return ok(results);
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_long_running_transactions
  // ============================================================
  server.tool(
    "get_long_running_transactions",
    "Get long-running open transactions. Open transactions hold locks, prevent log truncation, and can cause blocking cascades. Critical for troubleshooting production incidents. Shows transaction age, log bytes used, lock count, and current SQL text.",
    { ...instanceParam,
      min_duration_seconds: z
        .number()
        .min(0)
        .default(60)
        .describe("Minimum transaction duration in seconds to report (default: 60)"),
    },
    async ({ instance_name, min_duration_seconds }) => {
      try {
        const { rows } = await queryInstance(instance_name, `
          SELECT
            st.session_id,
            s.login_name,
            s.host_name,
            s.program_name,
            DB_NAME(sdt.database_id)                      AS database_name,
            at.transaction_id,
            at.name                                       AS transaction_name,
            at.transaction_begin_time,
            DATEDIFF(SECOND, at.transaction_begin_time, GETDATE()) AS duration_seconds,
            CASE at.transaction_type
              WHEN 1 THEN 'Read/write'
              WHEN 2 THEN 'Read-only'
              WHEN 3 THEN 'System'
              WHEN 4 THEN 'Distributed'
              ELSE 'Unknown'
            END                                           AS transaction_type,
            CASE at.transaction_state
              WHEN 0 THEN 'Not initialized'
              WHEN 1 THEN 'Initialized, not started'
              WHEN 2 THEN 'Active'
              WHEN 3 THEN 'Read-only ended'
              WHEN 4 THEN 'Distributed - prepared'
              WHEN 5 THEN 'Distributed - committed'
              WHEN 6 THEN 'Committed'
              WHEN 7 THEN 'Rolling back'
              WHEN 8 THEN 'Rolled back'
              ELSE 'Unknown'
            END                                           AS transaction_state,
            sdt.database_transaction_log_bytes_used / 1048576 AS log_mb_used,
            sdt.database_transaction_log_bytes_reserved / 1048576 AS log_mb_reserved,
            (SELECT COUNT(*)
             FROM sys.dm_tran_locks tl
             WHERE tl.request_session_id = st.session_id
            )                                             AS locks_held,
            r.command,
            r.status                                      AS request_status,
            r.wait_type,
            r.blocking_session_id,
            SUBSTRING(
              sqlt.text,
              (r.statement_start_offset / 2) + 1,
              ((CASE r.statement_end_offset
                  WHEN -1 THEN DATALENGTH(sqlt.text)
                  ELSE r.statement_end_offset
                END - r.statement_start_offset) / 2) + 1
            )                                             AS current_statement
          FROM sys.dm_tran_active_transactions at
          JOIN sys.dm_tran_session_transactions st ON at.transaction_id = st.transaction_id
          JOIN sys.dm_exec_sessions s ON st.session_id = s.session_id
          LEFT JOIN sys.dm_tran_database_transactions sdt
            ON at.transaction_id = sdt.transaction_id
          LEFT JOIN sys.dm_exec_requests r ON st.session_id = r.session_id
          OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) sqlt
          WHERE DATEDIFF(SECOND, at.transaction_begin_time, GETDATE()) >= ${min_duration_seconds}
            AND s.is_user_process = 1
          ORDER BY duration_seconds DESC
        `);

        if (rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No transactions running longer than ${min_duration_seconds} seconds.`,
              },
            ],
          };
        }
        return ok({ long_running_transactions: rows });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_deadlock_history
  // ============================================================
  server.tool(
    "get_deadlock_history",
    "Get recent deadlock history from the system_health Extended Events ring buffer. Returns parsed deadlock XML including victim query, deadlock graph, resources involved, and timestamps. No trace flags or profiler required.",
    { ...instanceParam,
      max_deadlocks: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum number of recent deadlocks to return (default: 20)"),
    },
    async ({ instance_name, max_deadlocks }) => {
      try {
        const { rows } = await queryInstance(instance_name, `
          WITH DeadlockData AS (
            SELECT
              CAST(target_data AS XML)                    AS target_data_xml
            FROM sys.dm_xe_session_targets xet
            JOIN sys.dm_xe_sessions xes
              ON xes.address = xet.event_session_address
            WHERE xes.name = 'system_health'
              AND xet.target_name = 'ring_buffer'
          ),
          DeadlockEvents AS (
            SELECT
              event_data.value('(@timestamp)[1]', 'datetime2') AS event_timestamp,
              CAST(event_data.query('.') AS NVARCHAR(MAX)) AS deadlock_xml
            FROM DeadlockData
            CROSS APPLY target_data_xml.nodes('//RingBufferTarget/event[@name="xml_deadlock_report"]') AS t(event_data)
          )
          SELECT TOP (${max_deadlocks})
            event_timestamp,
            deadlock_xml
          FROM DeadlockEvents
          ORDER BY event_timestamp DESC
        `);

        if (rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No deadlocks found in the system_health ring buffer. The buffer may have wrapped or there have been no recent deadlocks.",
              },
            ],
          };
        }
        return ok({ deadlock_history: rows, note: "Parse deadlock_xml for detailed victim/process/resource information" });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_latch_stats
  // ============================================================
  server.tool(
    "get_latch_stats",
    "Get latch wait statistics by class. Latches are lightweight internal synchronization primitives. Key signals: PAGEIOLATCH_* = physical I/O waits (should be near-zero on flash storage); PAGELATCH_* = in-memory page contention (e.g., hot last-page inserts on identity PKs, allocation contention). High PAGELATCH_EX on non-flash is often tempdb or allocation.",
    { ...instanceParam,
      exclude_zero_waits: z
        .boolean()
        .default(true)
        .describe("Exclude latch classes with zero waits (default: true)"),
      top_n: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(30)
        .describe("Number of latch classes to return (default: 30)"),
    },
    async ({ instance_name, exclude_zero_waits, top_n }) => {
      const zeroFilter = exclude_zero_waits ? "WHERE waiting_requests_count > 0" : "";

      try {
        const { rows } = await queryInstance(instance_name, `
          SELECT TOP (${top_n})
            latch_class,
            waiting_requests_count,
            wait_time_ms,
            max_wait_time_ms,
            CASE WHEN waiting_requests_count > 0
                 THEN wait_time_ms / waiting_requests_count
                 ELSE 0
            END                                           AS avg_wait_time_ms
          FROM sys.dm_os_latch_stats
          ${zeroFilter}
          ORDER BY wait_time_ms DESC
        `);

        if (rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No latch waits detected (all classes have zero wait time).",
              },
            ],
          };
        }
        return ok({ latch_stats: rows });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_ag_health
  // ============================================================
  server.tool(
    "get_ag_health",
    "Get Always On Availability Group health: replica sync state, send/redo queue size, estimated data loss/recovery time, failover readiness. Only returns data if AG is configured. Key metrics: synchronization_health (HEALTHY vs PARTIALLY_HEALTHY), redo_queue_size (backlog on secondary), estimated_data_loss_time.",
    { ...instanceParam },
    async ({ instance_name }) => {
      try {
        const { rows } = await queryInstance(instance_name, `
          SELECT
            ag.name                                       AS ag_name,
            ar.replica_server_name,
            ar.availability_mode_desc,
            ar.failover_mode_desc,
            ars.role_desc,
            ars.connected_state_desc,
            ars.synchronization_health_desc,
            ars.is_local,
            DB_NAME(drs.database_id)                       AS database_name,
            drs.synchronization_state_desc,
            drs.is_suspended,
            drs.suspend_reason_desc,
            drs.log_send_queue_size / 1024                AS send_queue_mb,
            drs.log_send_rate / 1024                      AS send_rate_mb_per_sec,
            drs.redo_queue_size / 1024                    AS redo_queue_mb,
            drs.redo_rate / 1024                          AS redo_rate_mb_per_sec,
            CASE WHEN drs.redo_rate > 0
                 THEN CAST(drs.redo_queue_size / drs.redo_rate AS INT)
                 ELSE NULL
            END                                           AS estimated_recovery_seconds,
            drs.last_commit_time,
            drs.last_hardened_time,
            DATEDIFF(SECOND, drs.last_hardened_time, drs.last_commit_time) AS estimated_data_loss_seconds
          FROM sys.availability_groups ag
          JOIN sys.availability_replicas ar ON ag.group_id = ar.group_id
          JOIN sys.dm_hadr_availability_replica_states ars
            ON ar.replica_id = ars.replica_id
          LEFT JOIN sys.dm_hadr_database_replica_states drs
            ON ar.replica_id = drs.replica_id
          WHERE ars.is_local = 1
             OR ar.replica_server_name IN (
               SELECT replica_server_name
               FROM sys.availability_replicas
             )
          ORDER BY
            ag.name,
            ar.replica_server_name,
            DB_NAME(drs.database_id)
        `);

        if (rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No Always On Availability Groups configured on this instance.",
              },
            ],
          };
        }
        return ok({ ag_health: rows });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_backup_status
  // ============================================================
  server.tool(
    "get_backup_status",
    "Get last backup time for each database (full, differential, and log) from msdb.dbo.backupset. Identifies databases with stale backups or missing log backups. Compliance risk if last_full_backup_days > 7 or last_log_backup_hours > 1 (for FULL recovery model).",
    { ...instanceParam,
      include_system_dbs: z
        .boolean()
        .default(false)
        .describe("Include system databases (master, model, msdb) in results (default: false)"),
    },
    async ({ instance_name, include_system_dbs }) => {
      const systemDbFilter = include_system_dbs
        ? ""
        : "AND d.database_id > 4";

      try {
        const { rows } = await queryInstance(instance_name, `
          SELECT
            d.name                                        AS database_name,
            d.recovery_model_desc,
            d.state_desc,
            last_full.backup_finish_date                  AS last_full_backup,
            DATEDIFF(DAY, last_full.backup_finish_date, GETDATE()) AS last_full_backup_days,
            last_diff.backup_finish_date                  AS last_diff_backup,
            DATEDIFF(DAY, last_diff.backup_finish_date, GETDATE()) AS last_diff_backup_days,
            last_log.backup_finish_date                   AS last_log_backup,
            DATEDIFF(HOUR, last_log.backup_finish_date, GETDATE()) AS last_log_backup_hours,
            last_full.backup_size / 1073741824.0          AS last_full_backup_gb,
            last_full.compressed_backup_size / 1073741824.0 AS last_full_compressed_gb,
            CASE
              WHEN last_full.backup_finish_date IS NULL THEN 'NEVER_BACKED_UP'
              WHEN d.recovery_model_desc = 'FULL'
               AND last_log.backup_finish_date IS NULL THEN 'NO_LOG_BACKUPS'
              WHEN DATEDIFF(DAY, last_full.backup_finish_date, GETDATE()) > 7 THEN 'STALE_FULL'
              WHEN d.recovery_model_desc = 'FULL'
               AND DATEDIFF(HOUR, last_log.backup_finish_date, GETDATE()) > 2 THEN 'STALE_LOG'
              ELSE 'OK'
            END                                           AS backup_health
          FROM sys.databases d
          OUTER APPLY (
            SELECT TOP 1
              backup_finish_date,
              backup_size,
              compressed_backup_size
            FROM msdb.dbo.backupset
            WHERE database_name = d.name
              AND type = 'D'
            ORDER BY backup_finish_date DESC
          ) last_full
          OUTER APPLY (
            SELECT TOP 1 backup_finish_date
            FROM msdb.dbo.backupset
            WHERE database_name = d.name
              AND type = 'I'
            ORDER BY backup_finish_date DESC
          ) last_diff
          OUTER APPLY (
            SELECT TOP 1 backup_finish_date
            FROM msdb.dbo.backupset
            WHERE database_name = d.name
              AND type = 'L'
            ORDER BY backup_finish_date DESC
          ) last_log
          WHERE d.state = 0
            ${systemDbFilter}
          ORDER BY
            CASE
              WHEN last_full.backup_finish_date IS NULL THEN 0
              ELSE 1
            END,
            last_full.backup_finish_date ASC
        `);
        return ok({ backup_status: rows });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_vlf_count
  // ============================================================
  server.tool(
    "get_vlf_count",
    "Get Virtual Log File (VLF) count per database. High VLF counts (>1000) indicate the transaction log was grown in many small increments, causing slow recovery, backups, and log shipping. Fix by shrinking the log (after a log backup in FULL mode) and pre-growing it in large chunks.",
    { ...instanceParam },
    async ({ instance_name }) => {
      try {
        const { rows } = await queryInstance(instance_name, `
          SELECT
            d.name                                        AS database_name,
            vlf.vlf_count,
            mf.size * 8 / 1024                            AS log_size_mb,
            CASE
              WHEN vlf.vlf_count > 1000 THEN 'CRITICAL'
              WHEN vlf.vlf_count > 500  THEN 'WARNING'
              ELSE 'OK'
            END                                           AS vlf_health
          FROM sys.databases d
          CROSS APPLY (
            SELECT COUNT(*) AS vlf_count
            FROM sys.dm_db_log_info(d.database_id)
          ) vlf
          LEFT JOIN sys.master_files mf
            ON d.database_id = mf.database_id
           AND mf.type = 1
          WHERE d.state = 0
            AND d.database_id > 4
          ORDER BY vlf.vlf_count DESC;
        `);
        return ok({ vlf_counts: rows });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_buffer_pool_by_object
  // ============================================================
  server.tool(
    "get_buffer_pool_by_object",
    "Get buffer pool (RAM cache) consumption by table and index. Shows which objects are resident in memory. On large-memory servers, knowing what's cached is critical for capacity planning. High buffer counts for a table = hot data; low buffer counts despite high reads = potential memory pressure.",
    { ...instanceParam,
      database_name: z
        .string()
        .optional()
        .describe("Filter to a specific database (default: all user databases)"),
      top_n: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(50)
        .describe("Number of top objects to return (default: 50)"),
    },
    async ({ instance_name, database_name, top_n }) => {
      // sys.allocation_units, sys.partitions, and sys.indexes are per-database catalog
      // views; from master context they only return master's data. dm_os_buffer_descriptors
      // is instance-wide, so user-DB pages drop out of the JOIN. Fix: execute per-database
      // via sp_executesql so catalog views resolve in the correct DB context.
      const dbWhere = database_name
        ? `WHERE name = N'${database_name.replace(/'/g, "''")}' AND state = 0`
        : "WHERE database_id > 4 AND state = 0 AND is_read_only = 0";

      try {
        const { rows } = await queryInstance(instance_name, `
          IF OBJECT_ID('tempdb..#bp_objects') IS NOT NULL DROP TABLE #bp_objects;
          CREATE TABLE #bp_objects (
            database_name NVARCHAR(128),
            object_name   NVARCHAR(256),
            index_name    NVARCHAR(256),
            index_type    NVARCHAR(60),
            buffer_mb     BIGINT,
            page_count    BIGINT,
            dirty_pages   BIGINT
          );

          DECLARE @db        NVARCHAR(128);
          DECLARE @inner_sql NVARCHAR(MAX) = N'
            INSERT INTO #bp_objects
            SELECT
              DB_NAME()                           AS database_name,
              OBJECT_NAME(p.object_id)            AS object_name,
              i.name                              AS index_name,
              i.type_desc                         AS index_type,
              COUNT(*) * 8 / 1024                 AS buffer_mb,
              COUNT(*)                            AS page_count,
              SUM(CASE WHEN bd.is_modified = 1 THEN 1 ELSE 0 END) AS dirty_pages
            FROM sys.dm_os_buffer_descriptors bd
            JOIN sys.allocation_units au
              ON bd.allocation_unit_id = au.allocation_unit_id
            JOIN sys.partitions p
              ON au.container_id = p.hobt_id
             AND au.type IN (1, 3)
            LEFT JOIN sys.indexes i
              ON p.object_id = i.object_id
             AND p.index_id  = i.index_id
            WHERE bd.database_id = DB_ID()
            GROUP BY p.object_id, i.name, i.type_desc';

          DECLARE db_cur CURSOR LOCAL FAST_FORWARD FOR
            SELECT name FROM sys.databases ${dbWhere};
          OPEN db_cur;
          FETCH NEXT FROM db_cur INTO @db;
          WHILE @@FETCH_STATUS = 0
          BEGIN
            DECLARE @full_sql NVARCHAR(MAX) = N'USE [' + @db + N']; ' + @inner_sql;
            BEGIN TRY
              EXEC sp_executesql @full_sql;
            END TRY
            BEGIN CATCH
              -- Skip inaccessible databases
            END CATCH;
            FETCH NEXT FROM db_cur INTO @db;
          END;
          CLOSE db_cur; DEALLOCATE db_cur;

          SELECT TOP (${top_n}) * FROM #bp_objects ORDER BY buffer_mb DESC;
          DROP TABLE #bp_objects;
        `);
        return ok({ buffer_pool_by_object: rows });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_statistics_health
  // ============================================================
  server.tool(
    "get_statistics_health",
    "Get statistics staleness for all user tables. Stale statistics cause bad cardinality estimates and poor query plans. Shows rows modified since last update (rowmodctr) and last stats update time. High modification_count relative to rows = stale stats. Auto-update threshold: ~20% for small tables, lower % for large tables.",
    { ...instanceParam,
      database_name: z
        .string()
        .describe("Database name to check (statistics are per-database)"),
      min_modification_pct: z
        .number()
        .min(0)
        .max(100)
        .default(10)
        .describe("Minimum modification % to report (default: 10%)"),
    },
    async ({ instance_name, database_name, min_modification_pct }) => {
      const dbNameEscaped = database_name.replace(/'/g, "''");
      try {
        const { rows } = await queryInstance(instance_name, `
          USE [${dbNameEscaped}];

          SELECT
            OBJECT_SCHEMA_NAME(s.object_id)               AS schema_name,
            OBJECT_NAME(s.object_id)                      AS table_name,
            s.name                                        AS stats_name,
            sp.last_updated,
            DATEDIFF(DAY, sp.last_updated, GETDATE())     AS days_since_update,
            sp.rows                                       AS rows_at_last_update,
            sp.rows_sampled,
            sp.modification_counter,
            CASE WHEN sp.rows > 0
                 THEN CAST(100.0 * sp.modification_counter / sp.rows AS DECIMAL(10, 2))
                 ELSE 0
            END                                           AS modification_pct,
            sp.steps                                      AS histogram_steps,
            s.auto_created,
            s.user_created,
            s.no_recompute,
            s.is_incremental
          FROM sys.stats s
          CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
          WHERE OBJECTPROPERTY(s.object_id, 'IsUserTable') = 1
            AND sp.rows > 0
            AND CAST(100.0 * sp.modification_counter / sp.rows AS DECIMAL(10, 2)) >= ${min_modification_pct}
          ORDER BY
            sp.modification_counter DESC;
          USE master;
        `);

        if (rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No stale statistics found in database '${database_name}' with modification >= ${min_modification_pct}%.`,
              },
            ],
          };
        }
        return ok({ statistics_health: rows, database: database_name });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_index_fragmentation
  // ============================================================
  server.tool(
    "get_index_fragmentation",
    "Get index fragmentation and page density for all user tables using dm_db_index_physical_stats in SAMPLED mode. Key metrics: avg_fragmentation_in_percent (rebuild if > 30%, reorganize if 10-30%), avg_page_space_used_in_percent (low density = wasted space and I/O amplification). On flash storage, fragmentation hurts less for reads but increases log write amplification from page splits.",
    { ...instanceParam,
      database_name: z
        .string()
        .describe("Database name to analyze (fragmentation is per-database)"),
      min_fragmentation_pct: z
        .number()
        .min(0)
        .max(100)
        .default(10)
        .describe("Minimum fragmentation % to report (default: 10%)"),
      min_page_count: z
        .number()
        .int()
        .min(0)
        .default(1000)
        .describe("Minimum page count threshold — skip small indexes (default: 1000)"),
    },
    async ({ instance_name, database_name, min_fragmentation_pct, min_page_count }) => {
      const dbNameEscaped = database_name.replace(/'/g, "''");
      try {
        const { rows } = await queryInstance(instance_name, `
          USE [${dbNameEscaped}];

          SELECT
            OBJECT_SCHEMA_NAME(ips.object_id)             AS schema_name,
            OBJECT_NAME(ips.object_id)                    AS table_name,
            i.name                                        AS index_name,
            i.type_desc                                   AS index_type,
            ips.index_level,
            ips.avg_fragmentation_in_percent,
            ips.fragment_count,
            ips.avg_fragment_size_in_pages,
            ips.page_count,
            ips.avg_page_space_used_in_percent,
            ips.record_count,
            ips.ghost_record_count,
            CASE
              WHEN ips.avg_fragmentation_in_percent >= 30 THEN 'REBUILD'
              WHEN ips.avg_fragmentation_in_percent >= 10 THEN 'REORGANIZE'
              ELSE 'OK'
            END                                           AS recommendation
          FROM sys.dm_db_index_physical_stats(
            DB_ID(),
            NULL,
            NULL,
            NULL,
            'SAMPLED'
          ) ips
          JOIN sys.indexes i
            ON ips.object_id = i.object_id
           AND ips.index_id = i.index_id
          WHERE ips.index_level = 0
            AND ips.page_count >= ${min_page_count}
            AND ips.avg_fragmentation_in_percent >= ${min_fragmentation_pct}
            AND i.name IS NOT NULL
          ORDER BY
            ips.avg_fragmentation_in_percent DESC;
          USE master;
        `);

        if (rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No fragmented indexes found in database '${database_name}' with fragmentation >= ${min_fragmentation_pct}% and page_count >= ${min_page_count}.`,
              },
            ],
          };
        }
        return ok({ index_fragmentation: rows, database: database_name });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_job_status
  // ============================================================
  server.tool(
    "get_job_status",
    "Get SQL Agent job execution status: last run outcome, duration, next scheduled run, currently executing jobs. Essential for operational monitoring. Identifies failed jobs that need attention.",
    { ...instanceParam },
    async ({ instance_name }) => {
      try {
        const { rows } = await queryInstance(instance_name, `
          SELECT
            j.name                                        AS job_name,
            j.enabled                                     AS job_enabled,
            CASE jh.run_status
              WHEN 0 THEN 'Failed'
              WHEN 1 THEN 'Succeeded'
              WHEN 2 THEN 'Retry'
              WHEN 3 THEN 'Canceled'
              WHEN 4 THEN 'In Progress'
              ELSE 'Unknown'
            END                                           AS last_run_status,
            STUFF(STUFF(RIGHT('000000' + CAST(jh.run_date AS VARCHAR(8)), 8), 5, 0, '-'), 8, 0, '-') AS last_run_date,
            STUFF(STUFF(RIGHT('000000' + CAST(jh.run_time AS VARCHAR(6)), 6), 3, 0, ':'), 6, 0, ':') AS last_run_time,
            jh.run_duration / 10000                       AS duration_hours,
            (jh.run_duration % 10000) / 100               AS duration_minutes,
            jh.run_duration % 100                         AS duration_seconds,
            jh.message                                    AS last_run_message,
            ja.start_execution_date                       AS currently_executing_since,
            DATEDIFF(SECOND, ja.start_execution_date, GETDATE()) AS execution_duration_seconds,
            CASE
              WHEN ja.start_execution_date IS NOT NULL THEN 'RUNNING'
              WHEN jh.run_status = 0 THEN 'FAILED'
              WHEN j.enabled = 0 THEN 'DISABLED'
              ELSE 'IDLE'
            END                                           AS current_state
          FROM msdb.dbo.sysjobs j
          LEFT JOIN (
            SELECT
              job_id,
              run_status,
              run_date,
              run_time,
              run_duration,
              message,
              ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY run_date DESC, run_time DESC) AS rn
            FROM msdb.dbo.sysjobhistory
            WHERE step_id = 0
          ) jh ON j.job_id = jh.job_id AND jh.rn = 1
          LEFT JOIN msdb.dbo.sysjobactivity ja
            ON j.job_id = ja.job_id
           AND ja.start_execution_date IS NOT NULL
           AND ja.stop_execution_date IS NULL
           AND ja.session_id = (
             SELECT MAX(session_id)
             FROM msdb.dbo.sysjobactivity
           )
          ORDER BY
            CASE
              WHEN ja.start_execution_date IS NOT NULL THEN 0
              WHEN jh.run_status = 0 THEN 1
              ELSE 2
            END,
            j.name
        `);
        return ok({ job_status: rows });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_columnstore_health
  // ============================================================
  server.tool(
    "get_columnstore_health",
    "Get columnstore index health: rowgroup states, delta store size, compression quality. Delta stores are uncompressed rowgroups — too many indicate the tuple mover isn't keeping up or inserts are trickle-loading. Low compressed rowgroup size (<1M rows per rowgroup) indicates small batch inserts or excessive deletes.",
    { ...instanceParam,
      database_name: z
        .string()
        .optional()
        .describe("Filter to a specific database (default: all user databases)"),
    },
    async ({ instance_name, database_name }) => {
      const dbWhere = database_name
        ? `WHERE name = N'${database_name.replace(/'/g, "''")}'`
        : "WHERE database_id > 4 AND state = 0 AND is_read_only = 0";

      try {
        // sys.dm_db_column_store_row_group_physical_stats is database-scoped,
        // so query each target database via sp_executesql with USE [db].
        const { rows } = await queryInstance(instance_name, `
          IF OBJECT_ID('tempdb..#cs_health') IS NOT NULL DROP TABLE #cs_health;
          CREATE TABLE #cs_health (
            database_name         NVARCHAR(128),
            schema_name           NVARCHAR(128),
            table_name            NVARCHAR(128),
            index_name            NVARCHAR(128),
            index_type            NVARCHAR(60),
            rowgroup_state        NVARCHAR(60),
            rowgroup_count        INT,
            total_rows            BIGINT,
            avg_rows_per_rowgroup BIGINT,
            total_deleted_rows    BIGINT,
            total_size_mb         BIGINT,
            health_status         NVARCHAR(60)
          );

          DECLARE @db       NVARCHAR(128);
          DECLARE @inner_sql NVARCHAR(MAX) = N'
            INSERT INTO #cs_health
            SELECT
              DB_NAME()                       AS database_name,
              OBJECT_SCHEMA_NAME(i.object_id) AS schema_name,
              OBJECT_NAME(i.object_id)        AS table_name,
              i.name                          AS index_name,
              i.type_desc                     AS index_type,
              rg.state_desc                   AS rowgroup_state,
              COUNT(*)                        AS rowgroup_count,
              SUM(rg.total_rows)              AS total_rows,
              AVG(rg.total_rows)              AS avg_rows_per_rowgroup,
              SUM(rg.deleted_rows)            AS total_deleted_rows,
              SUM(CASE WHEN rg.size_in_bytes > 0 THEN rg.size_in_bytes ELSE 0 END) / 1048576
                                              AS total_size_mb,
              CASE
                WHEN rg.state_desc = ''OPEN'' THEN ''DELTA_STORE''
                WHEN AVG(rg.total_rows) < 500000 THEN ''SMALL_ROWGROUPS''
                WHEN SUM(rg.deleted_rows) * 1.0 / NULLIF(SUM(rg.total_rows), 0) > 0.1 THEN ''HIGH_DELETES''
                ELSE ''HEALTHY''
              END                             AS health_status
            FROM sys.indexes i
            JOIN sys.dm_db_column_store_row_group_physical_stats rg
              ON i.object_id = rg.object_id AND i.index_id = rg.index_id
            WHERE i.type IN (5, 6)
            GROUP BY i.object_id, i.name, i.type_desc, rg.state_desc';

          DECLARE db_cur CURSOR LOCAL FAST_FORWARD FOR
            SELECT name FROM sys.databases ${dbWhere};
          OPEN db_cur;
          FETCH NEXT FROM db_cur INTO @db;
          WHILE @@FETCH_STATUS = 0
          BEGIN
            DECLARE @full_sql NVARCHAR(MAX) = N'USE [' + @db + N']; ' + @inner_sql;
            BEGIN TRY
              EXEC sp_executesql @full_sql;
            END TRY
            BEGIN CATCH
              -- Skip inaccessible databases
            END CATCH;
            FETCH NEXT FROM db_cur INTO @db;
          END;
          CLOSE db_cur; DEALLOCATE db_cur;

          SELECT * FROM #cs_health
          ORDER BY database_name, table_name, index_name, rowgroup_state;
          DROP TABLE #cs_health;
        `);

        if (rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: database_name
                  ? `No columnstore indexes found in database '${database_name}'.`
                  : "No columnstore indexes found in any user database.",
              },
            ],
          };
        }
        return ok({ columnstore_health: rows });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ============================================================
  // get_perfmon_counters
  // ============================================================
  server.tool(
    "get_perfmon_counters",
    "Get Windows Performance Monitor counters exposed by SQL Server. Includes key metrics: batch requests/sec, page life expectancy, lazy writes/sec, buffer cache hit ratio, etc. Use counter_category to filter (e.g., 'SQLServer:Buffer Manager', 'SQLServer:SQL Statistics').",
    { ...instanceParam,
      counter_category: z
        .string()
        .optional()
        .describe("Filter by counter category (e.g., 'SQLServer:Buffer Manager', 'SQLServer:SQL Statistics'). Leave empty for all categories."),
      counter_name: z
        .string()
        .optional()
        .describe("Filter by specific counter name (e.g., 'Page life expectancy', 'Batch requests/sec'). Leave empty for all counters."),
    },
    async ({ instance_name, counter_category, counter_name }) => {
      const categoryFilter = counter_category
        ? `AND object_name LIKE '%${counter_category.replace(/'/g, "''")}%'`
        : "";
      const nameFilter = counter_name
        ? `AND counter_name LIKE '%${counter_name.replace(/'/g, "''")}%'`
        : "";

      try {
        const { rows } = await queryInstance(instance_name, `
          SELECT
            RTRIM(object_name)                            AS object_name,
            RTRIM(counter_name)                           AS counter_name,
            RTRIM(instance_name)                          AS instance_name,
            cntr_value,
            cntr_type,
            CASE cntr_type
              WHEN 65792 THEN 'Count'
              WHEN 537003264 THEN 'Per-second rate'
              WHEN 1073939712 THEN 'Average'
              WHEN 1073874176 THEN 'Ratio (requires base)'
              WHEN 272696576 THEN 'Base counter for ratio'
              ELSE CAST(cntr_type AS VARCHAR(20))
            END                                           AS counter_type_description
          FROM sys.dm_os_performance_counters
          WHERE 1=1
            ${categoryFilter}
            ${nameFilter}
          ORDER BY
            object_name,
            counter_name,
            instance_name
        `);
        return ok({ perfmon_counters: rows });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );
}
