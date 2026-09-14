#!/usr/bin/env node
/**
 * Regression test for the row-limit / truncation defects fixed in v1.1.0.
 *
 * Guards three behaviours that were broken together:
 *   1. `truncated` was unsatisfiable. applyRowLimit() capped the rowset at
 *      exactly `maxRows` via SET ROWCOUNT, so `all.length > maxRows` could
 *      never be true. Oversized results came back silently clipped.
 *   2. The TOP bypass regex required a parenthesis (`/\bTOP\s*\(/i`) but every
 *      tool query uses the bare form (`TOP 256`), so the bypass never fired
 *      for the server's own SQL and a tool-level TOP could be swallowed by a
 *      smaller SET ROWCOUNT without any warning.
 *   3. Most call sites destructured `{ rows }` and discarded the flag, so even
 *      a correct flag would not have reached the caller.
 *
 * Run (host):
 *   node tests/truncation-regression.mjs
 *
 * Run (containerised, matching mcp-integration.mjs):
 *   docker run --rm -e MCP_URL=http://host.docker.internal:3001 \
 *     -v "$(pwd)/tests:/tests:ro" node:22-alpine node /tests/truncation-regression.mjs
 */

const SERVER_URL = process.env.MCP_URL ?? "http://localhost:3001";

// A source guaranteed to exceed any row cap we test against.
const BIG_SOURCE = "sys.all_objects a CROSS JOIN sys.all_objects b";

// ─────────────────────────────────────────────────────────────────────────────
// MCP Streamable HTTP client (raw — no SDK dependency)
// ─────────────────────────────────────────────────────────────────────────────
async function connectMcp(serverUrl) {
  const mcpUrl = `${serverUrl}/mcp`;
  let sessionId = null;
  let msgId = 1;

  const parseSse = (text) =>
    text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } })
      .filter(Boolean);

  async function post(payload, timeoutMs = 120_000) {
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;

    const r = await fetch(mcpUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const sid = r.headers.get("mcp-session-id");
    if (sid && !sessionId) sessionId = sid;
    if (!r.ok) throw new Error(`POST ${r.status}: ${await r.text()}`);

    const body = await r.text();
    if ((r.headers.get("content-type") ?? "").includes("text/event-stream")) {
      if (payload.id == null) return null;
      const match = parseSse(body).find((m) => m.id === payload.id);
      if (!match) throw new Error(`No response for id=${payload.id} in SSE body`);
      return match;
    }
    return body ? JSON.parse(body) : null;
  }

  await post({
    jsonrpc: "2.0",
    id: msgId++,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "truncation-regression", version: "1.0.0" },
    },
  }, 10_000);

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
    call: (name, args = {}, timeoutMs = 120_000) =>
      post({ jsonrpc: "2.0", id: msgId++, method: "tools/call", params: { name, arguments: args } }, timeoutMs),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Harness
// ─────────────────────────────────────────────────────────────────────────────
function getText(response) {
  if (response.error) throw new Error(`RPC error: ${JSON.stringify(response.error)}`);
  const text = response.result?.content?.[0]?.text ?? "";
  if (text.startsWith("Error:")) throw new Error(text);
  return text;
}
const getJson = (r) => JSON.parse(getText(r));

let pass = 0, fail = 0, skip = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};
const skipped = (name, why) => { skip++; console.log(`  SKIP  ${name} — ${why}`); };

const mcp = await connectMcp(SERVER_URL);

console.log(`\n=== Row-limit / truncation regression — ${SERVER_URL} ===\n`);

// ── 1. Oversized result must be flagged (defect 1) ──────────────────────────
console.log("1. Oversized result is reported, not silently clipped");
{
  const r = getJson(await mcp.call("execute_query", {
    instance_name: "SqlServer1",
    query: `SELECT a.name AS n1, b.name AS n2 FROM ${BIG_SOURCE}`,
  }));
  check("capped at row_limit", r.rows.length === r.row_limit, `rows=${r.rows.length}, row_limit=${r.row_limit}`);
  check("truncated === true", r.truncated === true, `truncated=${r.truncated}`);
}

// ── 2. No false positives, no sentinel-row leak ─────────────────────────────
console.log("\n2. Under-limit result is exact and unflagged");
{
  const expected = getJson(await mcp.call("execute_query", {
    instance_name: "SqlServer1", query: "SELECT COUNT(*) AS c FROM sys.databases",
  })).rows[0].c;
  const r = getJson(await mcp.call("execute_query", {
    instance_name: "SqlServer1", query: "SELECT name FROM sys.databases",
  }));
  check("truncated === false", r.truncated === false, `truncated=${r.truncated}`);
  check("exact row count (sentinel row not leaked)", r.rows.length === expected,
    `rows=${r.rows.length}, expected=${expected}`);
}

// ── 3. Boundary — this is what the limit+1 sentinel actually buys ───────────
// Exactly-at-limit must NOT be flagged; one-over must be flagged and trimmed.
console.log("\n3. Boundary at row_limit (sentinel-row logic)");
{
  const atLimit = getJson(await mcp.call("execute_query", {
    instance_name: "SqlServer1", query: `SELECT TOP 500 a.object_id FROM ${BIG_SOURCE}`,
  }));
  check("exactly row_limit available -> not truncated",
    atLimit.rows.length === 500 && atLimit.truncated === false,
    `rows=${atLimit.rows.length}, truncated=${atLimit.truncated}`);

  const overLimit = getJson(await mcp.call("execute_query", {
    instance_name: "SqlServer1", query: `SELECT TOP 501 a.object_id FROM ${BIG_SOURCE}`,
  }));
  check("one over row_limit -> truncated and trimmed",
    overLimit.rows.length === 500 && overLimit.truncated === true,
    `rows=${overLimit.rows.length}, truncated=${overLimit.truncated}`);
}

// ── 4. Bare TOP composes with SET ROWCOUNT (defect 2) ───────────────────────
// Deterministic: does NOT depend on ring-buffer warmth. fan_out_query caps at
// 200, so a bare TOP 256 exceeds the cap. Under the old bypass regex the TOP
// was swallowed by SET ROWCOUNT 200 and reported truncated:false.
console.log("\n4. Bare TOP is seen by the row limiter (old bypass regex required a paren)");
{
  const fan = getJson(await mcp.call("fan_out_query", {
    query: `SELECT TOP 256 a.name AS n FROM ${BIG_SOURCE}`,
  }));
  const names = Object.keys(fan.results);
  check("all instances answered", fan.instances_failed === 0,
    `queried=${fan.instances_queried}, failed=${fan.instances_failed}`);
  check("bare TOP over the cap is flagged on every instance",
    names.length > 0 && names.every((n) => fan.results[n].truncated === true),
    names.map((n) => `${n}:${fan.results[n].rows.length}/${fan.results[n].truncated}`).join(" "));
}

// ── 5. get_cpu_history — TOP 256 must not be clipped by a smaller cap ───────
// Structural assertion always runs. The row-count assertion needs ~256 minutes
// of uptime for the scheduler-monitor ring buffer to fill, so it is skipped
// (loudly) on a freshly started instance rather than passing vacuously.
console.log("\n5. get_cpu_history: row cap matches its own TOP 256");
{
  const cpu = getJson(await mcp.call("get_cpu_history", { instance_name: "SqlServer1" }));
  check("row_limit === 256 (matches TOP 256)", cpu.row_limit === 256, `row_limit=${cpu.row_limit}`);

  const uptime = getJson(await mcp.call("execute_query", {
    instance_name: "SqlServer1",
    query: "SELECT DATEDIFF(minute, sqlserver_start_time, GETDATE()) AS m FROM sys.dm_os_sys_info",
  })).rows[0].m;

  const samples = cpu.cpu_history.length;
  if (uptime >= 256) {
    check("full ring buffer returns all 256 samples", samples === 256 && cpu.truncated === false,
      `samples=${samples}, truncated=${cpu.truncated}, uptime=${uptime}min`);
  } else {
    skipped("full ring buffer returns all 256 samples",
      `needs ~256 min uptime, instance has ${uptime} min (${256 - uptime} to go); ` +
      `saw ${samples} samples, truncated=${cpu.truncated}`);
    check("partial buffer is not falsely flagged", cpu.truncated === false,
      `samples=${samples}, truncated=${cpu.truncated}`);
  }
}

// ── 6. Subquery TOP is unaffected by the wrapper ────────────────────────────
// SET ROWCOUNT limits the final rowset only; nested TOP must still materialise
// in full, otherwise the wrapper would corrupt aggregate results.
console.log("\n6. Nested TOP still materialises fully");
{
  const r = getJson(await mcp.call("execute_query", {
    instance_name: "SqlServer1",
    query: `SELECT COUNT(*) AS n FROM (SELECT TOP 600 a.name FROM ${BIG_SOURCE}) q`,
  }));
  check("inner TOP 600 not clipped by outer cap", r.rows[0].n === 600, `got ${r.rows[0].n}`);
}

// ── 7. Flag reaches the caller from a pre-built tool (defect 3) ─────────────
console.log("\n7. Pre-built tools surface truncated / row_limit");
{
  const w = getJson(await mcp.call("get_wait_stats", { instance_name: "SqlServer1" }));
  check("get_wait_stats exposes both fields",
    typeof w.truncated === "boolean" && typeof w.row_limit === "number",
    `truncated=${w.truncated}, row_limit=${w.row_limit}`);
}

console.log(`\n${"=".repeat(58)}`);
console.log(`${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed, ${skip} skipped\n`);
process.exit(fail === 0 ? 0 : 1);
