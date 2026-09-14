import sql from "mssql";

export interface InstanceConfig {
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Load instance list from INSTANCES env var (JSON array) or fall back to the
// single-instance env vars for backwards compatibility.
//
// Multi-instance format (INSTANCES env var):
//   [
//     { "name": "prod",  "host": "prod-sql01",  "port": 1433, "user": "dba_monitor", "password": "..." },
//     { "name": "dev",   "host": "dev-sql01",   "port": 1433, "user": "dba_monitor", "password": "..." }
//   ]
//
// Single-instance format (existing env vars — unchanged):
//   SQL_SERVER, SQL_PORT, SQL_USER, SQL_PASSWORD  →  registered as name "default"
// ─────────────────────────────────────────────────────────────────────────────
function loadInstances(): InstanceConfig[] {
  const raw = process.env.INSTANCES;
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`INSTANCES env var is not valid JSON: ${e}`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("INSTANCES env var must be a non-empty JSON array");
    }
    return parsed as InstanceConfig[];
  }

  // Backwards-compatible single instance
  return [
    {
      name:     "default",
      host:     process.env.SQL_SERVER   ?? "sqlserver",
      port:     parseInt(process.env.SQL_PORT ?? "1433", 10),
      user:     process.env.SQL_USER     ?? "dba_monitor",
      password: process.env.SQL_PASSWORD ?? "",
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection pool map — pools are created lazily on first use.
//
// The map stores the *connect promise*, not the pool, so two concurrent first
// calls for the same instance share one pool instead of racing to create two.
// ─────────────────────────────────────────────────────────────────────────────
const instances: Map<string, InstanceConfig> = new Map();
const pools: Map<string, Promise<sql.ConnectionPool>> = new Map();

export function initInstances(): void {
  for (const inst of loadInstances()) {
    instances.set(inst.name, inst);
  }
  console.log(
    `[db] Registered instances: ${[...instances.keys()].join(", ")} (default: ${defaultInstanceName()})`
  );
}

export function listInstances(): InstanceConfig[] {
  return [...instances.values()];
}

// The first registered instance is the default when a tool call omits
// instance_name. This is what the tools' schema advertises, and it works for
// both the INSTANCES array and the single-instance ("default") fallback.
export function defaultInstanceName(): string {
  const first = instances.keys().next();
  if (first.done) throw new Error("No SQL Server instances are registered");
  return first.value;
}

// Instance names are matched case-insensitively ("sqlserver2" finds "SqlServer2")
// because LLM callers frequently normalise case; the canonical name is used
// for the pool key so one instance never gets two pools.
function resolveInstanceName(requested?: string): string {
  if (!requested) return defaultInstanceName();
  if (instances.has(requested)) return requested;
  const lower = requested.toLowerCase();
  for (const name of instances.keys()) {
    if (name.toLowerCase() === lower) return name;
  }
  return requested; // unknown — getPool reports the available names
}

export async function getPool(instanceName?: string): Promise<sql.ConnectionPool> {
  const name = resolveInstanceName(instanceName);

  const existing = pools.get(name);
  if (existing) {
    const pool = await existing;
    if (pool.connected) return pool;
    pools.delete(name);
  }

  const cfg = instances.get(name);
  if (!cfg) {
    throw new Error(
      `Unknown instance "${name}". Available: ${[...instances.keys()].join(", ")}`
    );
  }

  const pool = new sql.ConnectionPool({
    server:   cfg.host,
    port:     cfg.port,
    user:     cfg.user,
    password: cfg.password,
    options:  { encrypt: true, trustServerCertificate: true },
    pool:     { max: 5, min: 0, idleTimeoutMillis: 30_000 },
  });

  pool.on("error", (err: Error) => {
    console.error(`[db] Pool error on "${name}":`, err.message);
    pools.delete(name);
    pool.close().catch(() => { /* already broken; nothing more to do */ });
  });

  const connecting = pool.connect().then((p) => {
    console.log(`[db] Connected to instance "${name}" (${cfg.host}:${cfg.port})`);
    return p;
  });
  connecting.catch(() => pools.delete(name));

  pools.set(name, connecting);
  return connecting;
}

// ─────────────────────────────────────────────────────────────────────────────
// queryInstance — run T-SQL on the named instance's pool with a row cap.
//
// The cap is enforced with SET ROWCOUNT (limit + 1): fetching one sentinel row
// past the limit is what lets `truncated` be observable. Callers get at most
// `maxRows` rows back and a flag telling them whether more existed.
//
// A caller-supplied TOP composes with SET ROWCOUNT (the smaller wins), so tool
// queries with TOP n are honoured as long as maxRows >= n. A caller-supplied
// SET ROWCOUNT is left alone so multi-statement batches can manage the cap
// themselves (see get_index_usage_stats).
// ─────────────────────────────────────────────────────────────────────────────
function applyRowLimit(sqlText: string, limit: number): string {
  if (/\bSET\s+ROWCOUNT\b/i.test(sqlText)) {
    return sqlText;
  }
  return `SET ROWCOUNT ${limit + 1};\n${sqlText}\nSET ROWCOUNT 0;`;
}

export async function queryInstance(
  instanceName: string | undefined,
  sqlText: string,
  maxRows = 200
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean; rowLimit: number }> {
  const pool = await getPool(instanceName);
  const result = await pool.request().query(applyRowLimit(sqlText, maxRows));
  const all = result.recordset as Record<string, unknown>[];
  const truncated = all.length > maxRows;
  return { rows: truncated ? all.slice(0, maxRows) : all, truncated, rowLimit: maxRows };
}
