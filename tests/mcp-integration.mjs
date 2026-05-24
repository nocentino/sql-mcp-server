#!/usr/bin/env node
/**
 * MCP Integration Test Suite — verifies all 30 tools via the real MCP protocol.
 * Uses Streamable HTTP transport (POST /mcp).
 *
 * Run:
 *   docker run --rm \
 *     -e MCP_URL=http://host.docker.internal:3001 \
 *     -v "$(pwd)/tests:/tests:ro" \
 *     node:22-alpine node /tests/mcp-integration.mjs
 */

const SERVER_URL = process.env.MCP_URL ?? "http://host.docker.internal:3001";

// ─────────────────────────────────────────────────────────────────────────────
// MCP Streamable HTTP client (raw — no SDK dependency)
// Each POST to /mcp returns an SSE response; session ID is passed as a header.
// ─────────────────────────────────────────────────────────────────────────────
async function connectMcp(serverUrl) {
  const mcpUrl = `${serverUrl}/mcp`;
  let sessionId = null;
  let msgId = 1;

  /** Parse all data: lines from an SSE response body and return parsed objects */
  function parseSseBody(text) {
    return text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => {
        try { return JSON.parse(l.slice(5).trim()); } catch { return null; }
      })
      .filter(Boolean);
  }

  async function post(payload, timeoutMs) {
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;

    const controller = new AbortController();
    const timer = timeoutMs
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      const r = await fetch(mcpUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (timer) clearTimeout(timer);

      // Capture session ID on first response
      const sid = r.headers.get("mcp-session-id");
      if (sid && !sessionId) sessionId = sid;

      if (!r.ok) throw new Error(`POST ${r.status}: ${await r.text()}`);

      const body = await r.text();
      const contentType = r.headers.get("content-type") ?? "";

      if (contentType.includes("text/event-stream")) {
        // SSE — find the message matching our request id
        const msgs = parseSseBody(body);
        if (payload.id == null) return null; // notification, no response expected
        const match = msgs.find((m) => m.id === payload.id);
        if (!match) throw new Error(`No response for id=${payload.id} in SSE body`);
        return match;
      }

      // Fallback: plain JSON response
      if (!body) return null;
      return JSON.parse(body);
    } catch (e) {
      if (timer) clearTimeout(timer);
      throw e;
    }
  }

  // MCP handshake
  await post(
    {
      jsonrpc: "2.0",
      id: msgId++,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "mcp-test", version: "1.0.0" },
      },
    },
    10_000
  );

  // Send initialized notification (no id — fire and forget)
  const notifHeaders = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
  };
  if (sessionId) notifHeaders["mcp-session-id"] = sessionId;
  await fetch(mcpUrl, {
    method: "POST",
    headers: notifHeaders,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
  });

  return {
    async call(name, args = {}, timeoutMs = 60_000) {
      const id = msgId++;
      return post({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, timeoutMs);
    },
    close() {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Response helpers
// ─────────────────────────────────────────────────────────────────────────────
function getText(response) {
  if (response.error) throw new Error(`RPC error: ${JSON.stringify(response.error)}`);
  const text = response.result?.content?.[0]?.text ?? "";
  if (text.startsWith("Error:")) throw new Error(text);
  return text;
}

function parseJson(text) {
  // Strip any non-JSON suffix (e.g. truncation notes appended after the closing brace)
  const last = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (last === -1) throw new Error("No JSON found in response");
  return JSON.parse(text.substring(0, last + 1));
}

function arr(data, key, minLen = 0) {
  if (!Array.isArray(data?.[key]))
    throw new Error(`Expected ${key} to be an array, got ${JSON.stringify(data)?.slice(0, 80)}`);
  if (data[key].length < minLen)
    throw new Error(`${key} has ${data[key].length} rows, expected >= ${minLen}`);
}

function cols(rows, ...names) {
  if (rows.length === 0) return;
  for (const n of names)
    if (!(n in rows[0])) throw new Error(`Missing column '${n}' (got: ${Object.keys(rows[0]).join(", ")})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test definitions — one entry per tool
// ─────────────────────────────────────────────────────────────────────────────
const TESTS = [
  {
    tool: "execute_query",
    args: { query: "SELECT @@VERSION AS server_version, SERVERPROPERTY('Edition') AS edition" },
    check(text) {
      const d = parseJson(text);
      if (!Array.isArray(d) || d.length === 0) throw new Error("Expected non-empty array");
      if (!String(d[0].server_version).includes("SQL Server"))
        throw new Error(`Unexpected version value: ${d[0].server_version}`);
    },
  },

  {
    tool: "get_active_sessions",
    args: { include_sleeping: false },
    check(text) {
      const d = parseJson(text);
      arr(d, "sessions");
      cols(d.sessions, "session_id", "login_name", "session_status");
    },
  },

  {
    tool: "get_blocking_chains",
    args: {},
    check(text) {
      if (text.includes("No blocking")) return;
      const d = parseJson(text);
      arr(d, "blocking_chains");
      cols(d.blocking_chains, "blocked_session_id", "blocking_session_id", "wait_seconds");
    },
  },

  {
    tool: "get_top_queries",
    args: { order_by: "cpu", top_n: 10 },
    check(text) {
      const d = parseJson(text);
      arr(d, "top_queries");
      if (d.top_queries.length > 0)
        cols(d.top_queries, "execution_count", "total_cpu_ms", "avg_cpu_ms", "query_text");
      if (d.ordered_by !== "cpu") throw new Error(`ordered_by should be 'cpu', got '${d.ordered_by}'`);
    },
  },

  {
    tool: "get_wait_stats",
    args: { exclude_benign: true },
    check(text) {
      const d = parseJson(text);
      arr(d, "wait_stats", 1);
      cols(d.wait_stats, "wait_type", "wait_time_ms", "pct_total");
      if (d.benign_waits_excluded !== true) throw new Error("benign_waits_excluded should be true");
      const total = d.wait_stats.reduce((s, r) => s + Number(r.pct_total), 0);
      if (total < 50 || total > 110) throw new Error(`pct_total sum ${total.toFixed(1)} looks wrong`);
    },
  },

  {
    tool: "get_file_io_stats",
    args: {},
    check(text) {
      const d = parseJson(text);
      arr(d, "file_io_stats", 1);
      cols(d.file_io_stats, "database_name", "logical_name", "avg_read_latency_ms", "avg_write_latency_ms");
      if (d.file_io_stats.every((r) => r.avg_read_latency_ms < 0))
        throw new Error("avg_read_latency_ms values look negative");
    },
  },

  {
    tool: "get_cpu_history",
    args: {},
    check(text) {
      const d = parseJson(text);
      arr(d, "cpu_history", 1);
      cols(d.cpu_history, "sql_cpu_pct", "system_idle_pct", "other_process_cpu_pct");
      // Each sample: sql + idle + other should be close to 100
      const first = d.cpu_history[0];
      const sum = first.sql_cpu_pct + first.system_idle_pct + first.other_process_cpu_pct;
      if (sum < 95 || sum > 105) throw new Error(`CPU sample sum ${sum} not close to 100`);
    },
  },

  {
    tool: "get_memory_usage",
    args: {},
    check(text) {
      const d = parseJson(text);
      arr(d, "system_memory", 1);
      arr(d, "top_memory_clerks", 1);
      arr(d, "resource_semaphores", 1);
      cols(d.system_memory, "total_physical_mb", "available_physical_mb", "system_memory_state_desc");
      cols(d.top_memory_clerks, "type", "pages_kb");
      if (d.system_memory[0].total_physical_mb <= 0) throw new Error("total_physical_mb should be > 0");
    },
  },

  {
    tool: "get_tempdb_usage",
    args: {},
    check(text) {
      const d = parseJson(text);
      arr(d, "file_space", 1);
      arr(d, "top_sessions");
      cols(d.file_space, "total_mb", "free_mb", "allocated_mb");
      if (d.file_space[0].total_mb <= 0) throw new Error("total_mb should be > 0");
    },
  },

  {
    tool: "get_database_info",
    args: {},
    check(text) {
      const d = parseJson(text);
      arr(d, "databases", 2);
      cols(d.databases, "name", "state_desc", "recovery_model_desc", "total_size_mb");
      const names = d.databases.map((r) => r.name);
      if (!names.includes("master")) throw new Error("master not in databases");
      if (!names.includes("ProductsDB")) throw new Error("ProductsDB not in databases");
      if (!d.databases.every((r) => r.state_desc === "ONLINE"))
        throw new Error("Not all databases are ONLINE");
    },
  },

  {
    tool: "get_server_info",
    args: {},
    check(text) {
      const d = parseJson(text);
      arr(d, "server_properties", 1);
      arr(d, "key_configurations", 1);
      arr(d, "system_info", 1);
      cols(d.server_properties, "product_version", "edition", "server_name");
      cols(d.system_info, "cpu_count", "physical_memory_mb", "uptime_hours");
      if (!String(d.server_properties[0].product_version).match(/^\d+\.\d+\.\d+/))
        throw new Error(`Invalid version format: ${d.server_properties[0].product_version}`);
      if (d.system_info[0].cpu_count < 1) throw new Error("cpu_count < 1");
    },
  },

  {
    tool: "get_missing_indexes",
    args: { min_impact: 0, top_n: 20 },
    check(text) {
      if (text.includes("No missing index")) return;
      const d = parseJson(text);
      arr(d, "missing_indexes");
      cols(d.missing_indexes, "table_name", "impact_score", "suggested_create_index");
      if (d.missing_indexes.some((r) => !r.suggested_create_index.startsWith("CREATE INDEX")))
        throw new Error("suggested_create_index has unexpected format");
    },
  },

  {
    // Response has a truncation note suffix — parseJson strips it
    tool: "get_index_usage_stats",
    args: {},
    check(text) {
      const d = parseJson(text);
      arr(d, "index_usage_stats");
      cols(d.index_usage_stats, "database_name", "table_name", "index_name", "user_seeks", "user_scans", "status");
    },
  },

  {
    tool: "get_database_files",
    args: {},
    check(text) {
      const d = parseJson(text);
      arr(d, "database_files", 2); // at minimum master data + log
      cols(d.database_files, "database_name", "logical_name", "file_type", "size_mb", "growth_setting", "is_read_only");
      // Verify ProductsDB files are present
      if (!d.database_files.some((r) => r.database_name === "ProductsDB"))
        throw new Error("ProductsDB files not present");
      // Verify the removed FILEPROPERTY columns are gone
      if ("space_used_mb" in d.database_files[0])
        throw new Error("space_used_mb column should not exist (FILEPROPERTY was removed)");
      // Sizes should be positive numbers
      if (!d.database_files.every((r) => r.size_mb >= 0))
        throw new Error("Some files have size_mb < 0");
    },
  },

  {
    tool: "get_query_store_regressions",
    args: { database_name: "ProductsDB", min_regression_pct: 50, top_n: 10 },
    check(text) {
      // Query Store may be disabled — both outcomes are valid
      if (text.includes("No Query Store regressions") || text.includes("query store")) return;
      const d = parseJson(text);
      arr(d, "query_store_regressions");
      if (d.database !== "ProductsDB") throw new Error(`database should be 'ProductsDB', got '${d.database}'`);
    },
  },

  {
    tool: "get_plan_cache_pollution",
    args: { analysis_type: "both", top_n: 10 },
    check(text) {
      const d = parseJson(text);
      arr(d, "single_use_plans");
      arr(d, "high_variance_queries");
      if (d.single_use_plans.length > 0)
        cols(d.single_use_plans, "database_name", "plan_size_kb", "query_text");
      if (d.high_variance_queries.length > 0)
        cols(d.high_variance_queries, "execution_count", "variance_ratio", "query_text");
    },
  },

  {
    tool: "get_long_running_transactions",
    args: { min_duration_seconds: 0 },
    check(text) {
      if (text.includes("No transactions running")) return;
      const d = parseJson(text);
      arr(d, "long_running_transactions");
      cols(d.long_running_transactions, "session_id", "transaction_name", "duration_seconds", "transaction_type", "transaction_state");
      if (!d.long_running_transactions.every((r) => r.duration_seconds >= 0))
        throw new Error("duration_seconds should be >= 0");
    },
  },

  {
    tool: "get_deadlock_history",
    args: { max_deadlocks: 10 },
    check(text) {
      // On a fresh server the tool returns a plain text message (no JSON)
      if (text.includes("No deadlocks") || text.includes("ring buffer")) return;
      const d = parseJson(text);
      arr(d, "deadlock_history");
      if (d.deadlock_history.length > 0)
        cols(d.deadlock_history, "event_timestamp", "deadlock_xml");
    },
  },

  {
    tool: "get_latch_stats",
    args: { exclude_zero_waits: false, top_n: 20 },
    check(text) {
      const d = parseJson(text);
      arr(d, "latch_stats", 1); // there are always latches even on idle server
      cols(d.latch_stats, "latch_class", "wait_time_ms", "waiting_requests_count", "max_wait_time_ms");
    },
  },

  {
    tool: "get_ag_health",
    args: {},
    check(text) {
      // No AG configured in test environment — message is expected
      if (text.includes("No Always On Availability Groups")) return;
      const d = parseJson(text);
      arr(d, "ag_health");
      cols(d.ag_health, "ag_name", "replica_server_name", "synchronization_health_desc");
    },
  },

  {
    tool: "get_backup_status",
    args: { include_system_dbs: true },
    check(text) {
      const d = parseJson(text);
      arr(d, "backup_status", 1);
      cols(d.backup_status, "database_name", "recovery_model_desc", "state_desc");
      if (!d.backup_status.some((r) => r.database_name === "master"))
        throw new Error("master should appear in backup_status");
    },
  },

  {
    tool: "get_vlf_count",
    args: {},
    check(text) {
      const d = parseJson(text);
      arr(d, "vlf_counts", 1);
      cols(d.vlf_counts, "database_name", "vlf_count", "log_size_mb", "vlf_health");
      if (!d.vlf_counts.some((r) => r.database_name === "ProductsDB"))
        throw new Error("ProductsDB not in vlf_counts");
      const valid = new Set(["OK", "WARNING", "CRITICAL"]);
      for (const r of d.vlf_counts)
        if (!valid.has(r.vlf_health)) throw new Error(`Invalid vlf_health value: '${r.vlf_health}'`);
      if (!d.vlf_counts.every((r) => Number(r.vlf_count) > 0))
        throw new Error("vlf_count should be > 0 for all databases");
    },
  },

  {
    tool: "get_buffer_pool_by_object",
    args: { top_n: 20 },
    check(text) {
      const d = parseJson(text);
      arr(d, "buffer_pool_by_object");
      if (d.buffer_pool_by_object.length > 0)
        cols(d.buffer_pool_by_object, "database_name", "object_name", "buffer_mb", "page_count", "dirty_pages");
    },
  },

  {
    tool: "get_statistics_health",
    args: { database_name: "ProductsDB", min_modification_pct: 0 },
    check(text) {
      if (text.includes("No stale statistics")) return;
      const d = parseJson(text);
      arr(d, "statistics_health", 1);
      cols(d.statistics_health, "table_name", "stats_name", "modification_pct", "last_updated", "rows_at_last_update");
      if (d.database !== "ProductsDB") throw new Error(`database should be 'ProductsDB'`);
    },
  },

  {
    tool: "get_index_fragmentation",
    // min_page_count:0 and min_fragmentation_pct:0 returns everything
    args: { database_name: "ProductsDB", min_fragmentation_pct: 0, min_page_count: 0 },
    check(text) {
      if (text.includes("No fragmented indexes")) return;
      const d = parseJson(text);
      arr(d, "index_fragmentation", 1);
      cols(d.index_fragmentation, "table_name", "index_name", "avg_fragmentation_in_percent", "page_count", "recommendation");
      const validRec = new Set(["REBUILD", "REORGANIZE", "OK"]);
      for (const r of d.index_fragmentation)
        if (!validRec.has(r.recommendation))
          throw new Error(`Invalid recommendation value: '${r.recommendation}'`);
      if (d.database !== "ProductsDB") throw new Error(`database should be 'ProductsDB'`);
    },
  },

  {
    tool: "get_job_status",
    args: {},
    check(text) {
      const d = parseJson(text);
      arr(d, "job_status"); // may be empty — SQL Agent may have no jobs in test env
      if (d.job_status.length > 0)
        cols(d.job_status, "job_name", "job_enabled", "last_run_status", "current_state");
    },
  },

  {
    tool: "get_columnstore_health",
    args: {},
    check(text) {
      if (text.includes("No columnstore indexes")) return;
      const d = parseJson(text);
      arr(d, "columnstore_health");
      cols(d.columnstore_health, "database_name", "table_name", "index_name", "rowgroup_state", "health_status");
    },
  },

  {
    tool: "get_perfmon_counters",
    args: { counter_category: "SQLServer:Buffer Manager" },
    check(text) {
      const d = parseJson(text);
      arr(d, "perfmon_counters", 1);
      cols(d.perfmon_counters, "object_name", "counter_name", "cntr_value", "counter_type_description");
      // Page life expectancy must always exist under Buffer Manager
      const ple = d.perfmon_counters.find((r) =>
        r.counter_name.toLowerCase().includes("page life expectancy")
      );
      if (!ple) throw new Error("Page life expectancy counter not found in Buffer Manager");
      if (Number(ple.cntr_value) < 0) throw new Error(`Page life expectancy is negative: ${ple.cntr_value}`);
    },
  },

  // ── Multi-instance: new tools ──────────────────────────────────────────────
  {
    tool: "list_instances",
    args: {},
    check(text) {
      const d = parseJson(text);
      if (!Array.isArray(d)) throw new Error("Expected array of instances");
      const names = d.map((i) => i.name);
      if (!names.includes("default"))
        throw new Error(`Missing "default" instance (got: ${names.join(", ")})`);
      if (!names.includes("sqlserver2"))
        throw new Error(`Missing "sqlserver2" instance (got: ${names.join(", ")})`);
    },
  },

  {
    tool: "fan_out_query",
    args: { query: "SELECT @@SERVERNAME AS server_name" },
    check(text) {
      const d = parseJson(text);
      if (d.instances_queried < 2)
        throw new Error(`Expected >= 2 instances_queried, got ${d.instances_queried}`);
      if (d.instances_failed > 0)
        throw new Error(`${d.instances_failed} instance(s) failed`);
      if (!d.results?.default?.rows?.length)
        throw new Error(`No rows from "default" instance`);
      if (!d.results?.sqlserver2?.rows?.length)
        throw new Error(`No rows from "sqlserver2" instance`);
      const nameA = d.results.default.rows[0].server_name;
      const nameB = d.results.sqlserver2.rows[0].server_name;
      if (nameA === nameB)
        throw new Error(`Both instances returned same server_name: ${nameA}`);
    },
  },

  // ── Multi-instance: routing via instance_name param ───────────────────────
  {
    tool: "execute_query",
    args: { query: "SELECT @@SERVERNAME AS server_name", instance_name: "sqlserver2" },
    check(text) {
      const d = parseJson(text);
      if (!Array.isArray(d) || d.length === 0) throw new Error("Expected non-empty array");
      if (d[0].server_name !== "sqlserver2")
        throw new Error(`Expected "sqlserver2", got "${d[0].server_name}"`);
    },
  },

  {
    tool: "get_server_info",
    args: { instance_name: "sqlserver2" },
    check(text) {
      const d = parseJson(text);
      arr(d, "server_properties", 1);
      const name = d.server_properties[0].server_name;
      if (name !== "sqlserver2")
        throw new Error(`Expected "sqlserver2", got "${name}"`);
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────
const G = "\x1b[32m";
const R = "\x1b[31m";
const Y = "\x1b[33m";
const B = "\x1b[34m";
const X = "\x1b[0m";

async function main() {
  console.log(`${B}=== MCP Tool Integration Tests ===${X}`);
  console.log(`Server: ${SERVER_URL}\n`);

  let mcp;
  try {
    process.stdout.write("Connecting... ");
    mcp = await connectMcp(SERVER_URL);
    console.log(`${G}connected${X}\n`);
  } catch (e) {
    console.error(`${R}FAILED: ${e.message}${X}`);
    process.exit(1);
  }

  let pass = 0,
    fail = 0;
  const failures = [];

  for (const t of TESTS) {
    const label = t.tool.padEnd(35);
    process.stdout.write(`  ${label} `);
    try {
      const response = await mcp.call(t.tool, t.args);
      const text = getText(response);
      t.check(text);
      console.log(`${G}PASS${X}`);
      pass++;
    } catch (e) {
      console.log(`${R}FAIL${X}  ${e.message}`);
      failures.push({ tool: t.tool, error: e.message });
      fail++;
    }
  }

  mcp.close();

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Total: ${pass + fail}   ${G}Pass: ${pass}${X}   ${fail > 0 ? R : G}Fail: ${fail}${X}`);

  if (failures.length > 0) {
    console.log(`\n${R}Failures:${X}`);
    for (const f of failures) console.log(`  ${f.tool}: ${f.error}`);
  }

  if (fail === 0) console.log(`\n${G}✓ All ${pass} tests passed${X}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
