# Handoff: row-limit / truncation defects in `queryInstance`

**Status:** resolved in v1.1.0 (kept as the record of the diagnosis; see the release notes for the fix).
**Scope:** `sql-mcp-server/src/connectionManager.ts`, `sql-mcp-server/src/tools.ts`
**Found:** 2026-09-14, while doing a fleet inventory against a 4-instance lab (SqlServer1–4, SQL Server 17.0.4050.1).

---

## Summary

Results are silently truncated. The `truncated` flag that is supposed to warn about
this is unsatisfiable and always returns `false`, so callers — including an LLM
reasoning over the output — cannot tell a complete result from a clipped one.

There are two related defects plus a propagation gap. Fix them together; fixing #1
alone still leaves most tools unable to report truncation.

---

## Defect 1 — `truncated` can never be `true` (primary)

`connectionManager.ts:99-116`:

```ts
function applyRowLimit(sqlText: string, limit: number): string {
  if (/\bTOP\s*\(/i.test(sqlText) || /\bSET\s+ROWCOUNT\b/i.test(sqlText)) {
    return sqlText;
  }
  return `SET ROWCOUNT ${limit};\n${sqlText}\nSET ROWCOUNT 0;`;   // caps at exactly `limit`
}

export async function queryInstance(instanceName, sqlText, maxRows = 200) {
  const result = await pool.request().query(applyRowLimit(sqlText, maxRows));
  const all = result.recordset as Record<string, unknown>[];
  const truncated = all.length > maxRows;      // <-- unsatisfiable
  return { rows: truncated ? all.slice(0, maxRows) : all, truncated };
}
```

`SET ROWCOUNT ${limit}` caps the returned rowset at exactly `limit` server-side.
`all.length` can therefore never exceed `maxRows`, so `truncated` is always `false`
and the `all.slice()` branch is dead.

Downstream, `truncationNote()` (`tools.ts:24`) is dead code. Both of its call sites
compute an always-empty string:

- `tools.ts:127` — `execute_query`: `const note = truncated ? truncationNote(500) : "";`
- `tools.ts:935` — `get_index_usage_stats`: `const note = truncated ? truncationNote(1000) : "";`

The flag is only reachable via the bypass path at line 100 — and see Defect 2 for
why that path never fires for built-in tools.

### Evidence

Ran through the live MCP server against SqlServer1:

```sql
SELECT a.name AS n1, b.name AS n2 FROM sys.all_objects a CROSS JOIN sys.all_objects b
```

Source set is millions of rows. `execute_query` returned exactly 500 rows, with
**no truncation note and `truncated: false`**. Silent data loss.

### Fix

Fetch one sentinel row past the limit so the existing comparison becomes meaningful:

```ts
return `SET ROWCOUNT ${limit + 1};\n${sqlText}\nSET ROWCOUNT 0;`;
```

`truncated = all.length > maxRows` then works as written, and the existing
`all.slice(0, maxRows)` already trims the sentinel. No call-site signature changes.

---

## Defect 2 — the `TOP` bypass never matches this codebase's own SQL

The bypass regex is `/\bTOP\s*\(/i` — it requires a parenthesis. Every `TOP` in
`tools.ts` uses the bare form:

| Line | Form | Tool |
|---|---|---|
| 482 | `TOP 256` | `get_cpu_history` |
| 556 | `TOP 30` | |
| 615 | `TOP 20` | |
| 1068, 1527, 1537, 1544 | `TOP 1` | |

None match. Every built-in tool query gets wrapped in `SET ROWCOUNT`, and the
bypass only ever fires when a *user* writes `TOP (n)` through `execute_query` or
`fan_out_query`.

**Consequence:** `get_cpu_history` asks for `TOP 256` samples but runs under the
default `maxRows = 200`, so it returns 200 — with `truncated` discarded at the call
site (`tools.ts:481` destructures `{ rows }` only). The tool's own description
promises "last ~256 minutes." *(Derived from the mechanism proven in Defect 1;
confirm with the `get_cpu_history` check in Verification below — the lab's
SqlServer3/SqlServer4 have ~49 h uptime, so the ring buffer is full.)*

### Fix

Do **not** simply relax the regex to `/\bTOP\b/i`. That would let any query
containing `TOP` bypass the row cap entirely — `SELECT TOP 100000` would return
unbounded rows through `execute_query`. That is a safety regression.

Instead, **remove the `TOP` bypass**. `SET ROWCOUNT` and `TOP` compose correctly —
the more restrictive of the two wins — so a query with `TOP 256` under
`SET ROWCOUNT 1001` returns 256 rows, which is the desired behavior. Keep the
`SET ROWCOUNT` self-reference guard so a caller-supplied `SET ROWCOUNT` is not
double-wrapped.

Then raise the internal default so tool-level `TOP` values are not clipped:
either bump `maxRows = 200` to something above the largest internal `TOP` (256),
or pass an explicit `maxRows` at the `get_cpu_history` call site. Prefer the
explicit call-site value — a global bump changes every tool's payload size.

### Verified non-issue

`SET ROWCOUNT` clips only the **final** result set, not subqueries. Tested:

```sql
SELECT COUNT(*) AS rows_materialized
FROM (SELECT TOP 600 a.name AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b) q
-- returned 600 under SET ROWCOUNT 500
```

So nested `TOP` and CTE internals are safe. Worth a second look anyway at
`tools.ts:861` (`get_index_usage_stats`), which runs a multi-statement batch with
`CREATE TABLE #idx_usage` / `INSERT` / `SELECT` / `DROP` under `SET ROWCOUNT 1000`:
`SET ROWCOUNT` applies to every statement in a batch and still affects
`INSERT`/`UPDATE`/`DELETE` in current SQL Server despite long-standing deprecation.
The evidence above suggests the `INSERT ... SELECT` is not clipped, but this one
was not directly tested.

---

## Defect 3 — `truncated` is discarded at ~40 of 44 call sites

Even after Defects 1 and 2 are fixed, only four call sites can report truncation.
Everything else destructures `{ rows }` and drops the flag on the floor.

Call sites that **do** handle it: `tools.ts:82` (`fan_out_query`), `126`
(`execute_query`), `154` (`get_active_sessions`), `861` (`get_index_usage_stats`).

All other `queryInstance(` calls discard it — full list via:

```bash
grep -n "queryInstance(" sql-mcp-server/src/tools.ts
```

The highest-value ones to fix first are the tools that can legitimately return
large result sets on a busy instance: `get_top_queries`, `get_missing_indexes`,
`get_index_fragmentation`, `get_database_files`, `get_wait_stats`.

### Fix

Surface the flag in the returned JSON rather than as an appended text note — a
structured field survives JSON parsing, the current `truncationNote()` string does
not. Suggested shape, applied in `ok()` or at each call site:

```ts
return ok({ wait_stats: rows, truncated, row_limit: maxRows });
```

If you change the response shape, keep `truncationNote()` or delete it outright —
do not leave it as dead code.

---

## Verification

No unit-test runner is configured. `sql-mcp-server/package.json` has only:

```
build:     esbuild src/index.ts --platform=node --target=node22 --bundle --packages=external --outfile=dist/index.js
start:     node dist/index.js
typecheck: tsc --noEmit
```

Existing tests are shell/integration only: `tests/smoke.sh`, `tests/tools.sh`,
`tests/integration.sh`, `tests/mcp-integration.mjs`. Add coverage there.

After the fix, confirm all three:

1. **Truncation is reported.** Through `execute_query`:
   ```sql
   SELECT a.name AS n1, b.name AS n2 FROM sys.all_objects a CROSS JOIN sys.all_objects b
   ```
   Expect 500 rows **and** `truncated: true` (currently: 500 rows, `truncated: false`).

2. **Small results are unaffected.** Any query returning fewer than `maxRows` rows
   must still report `truncated: false` — check the sentinel row is not leaking
   into output. `SELECT name FROM sys.databases` is a good case.

3. **Tool-level `TOP` is honored.** Call `get_cpu_history` against an instance with
   >256 minutes uptime. Expect 256 samples, not 200.

Also run `npm run typecheck` — the `queryInstance` return type is unchanged by the
recommended fix, so a clean typecheck plus the three checks above is sufficient.

---

## Out of scope (raised but deliberately not included)

These came up in the same review. They are design hardening, **not** defects, and
should be a separate change if wanted:

- `tools.ts:31-39` — the shared `instanceParam` is named `instance_name` and
  defaults to the hardcoded `"SqlServer1"`. A caller passing `instance` (or any
  misspelling) has the key silently stripped by zod and gets SqlServer1's data
  instead of an error. Responses never echo which instance answered, so a misroute
  is undetectable from the output. Consider making the param required and echoing
  `instance` in every response body.
- The hardcoded `"SqlServer1"` default also disagrees with
  `connectionManager.ts:65` (`getPool(instanceName = "default")`). Any deployment
  whose `INSTANCES` env var lacks a literal `SqlServer1` entry throws
  `Unknown instance` on every defaulted call.

## Confirmed correct — do not "fix"

- Per-instance pool routing in `connectionManager.ts` (`getPool` / `queryInstance`)
  is correct; cross-checked with `fan_out_query` returning four distinct servers.
- `list_instances` (`tools.ts:51`) correctly strips `password` from
  `InstanceConfig` before returning.
- The T-SQL bodies of the tools reviewed (`get_server_info`, `get_ag_health`,
  `get_backup_status`) are sound.
