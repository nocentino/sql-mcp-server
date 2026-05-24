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
    try {
      return JSON.parse(raw) as InstanceConfig[];
    } catch (e) {
      throw new Error(`INSTANCES env var is not valid JSON: ${e}`);
    }
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
// Connection pool map — pools are created lazily on first use
// ─────────────────────────────────────────────────────────────────────────────
const instances: Map<string, InstanceConfig> = new Map();
const pools: Map<string, sql.ConnectionPool> = new Map();

export function initInstances(): void {
  for (const inst of loadInstances()) {
    instances.set(inst.name, inst);
  }
  console.log(
    `[db] Registered instances: ${[...instances.keys()].join(", ")}`
  );
}

export function listInstances(): InstanceConfig[] {
  return [...instances.values()];
}

export async function getPool(instanceName = "default"): Promise<sql.ConnectionPool> {
  const existing = pools.get(instanceName);
  if (existing?.connected) return existing;

  const cfg = instances.get(instanceName);
  if (!cfg) {
    throw new Error(
      `Unknown instance "${instanceName}". Available: ${[...instances.keys()].join(", ")}`
    );
  }

  const pool = await new sql.ConnectionPool({
    server:   cfg.host,
    port:     cfg.port,
    user:     cfg.user,
    password: cfg.password,
    options:  { encrypt: true, trustServerCertificate: true },
    pool:     { max: 5, min: 0, idleTimeoutMillis: 30_000 },
  }).connect();

  pool.on("error", (err: Error) => {
    console.error(`[db] Pool error on "${instanceName}":`, err.message);
    pools.delete(instanceName);
  });

  pools.set(instanceName, pool);
  console.log(`[db] Connected to instance "${instanceName}" (${cfg.host}:${cfg.port})`);
  return pool;
}

// ─────────────────────────────────────────────────────────────────────────────
// queryInstance — drop-in replacement for the existing query() in db.ts,
// but routes to the named instance's pool instead of the global one.
// ─────────────────────────────────────────────────────────────────────────────
function applyRowLimit(sqlText: string, limit: number): string {
  if (/\bTOP\s*\(/i.test(sqlText) || /\bSET\s+ROWCOUNT\b/i.test(sqlText)) {
    return sqlText;
  }
  return `SET ROWCOUNT ${limit};\n${sqlText}\nSET ROWCOUNT 0;`;
}

export async function queryInstance(
  instanceName: string,
  sqlText: string,
  maxRows = 200
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const pool = await getPool(instanceName);
  const result = await pool.request().query(applyRowLimit(sqlText, maxRows));
  const all = result.recordset as Record<string, unknown>[];
  const truncated = all.length > maxRows;
  return { rows: truncated ? all.slice(0, maxRows) : all, truncated };
}
