import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { registerTools } from "./tools.js";
import { initInstances } from "./connectionManager.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

// ─────────────────────────────────────────────────────────────────────────────
// MCP Server — one McpServer instance per session (SDK requirement: a single
// McpServer cannot be connected to multiple transports simultaneously).
// ─────────────────────────────────────────────────────────────────────────────
initInstances();

function createServer() {
  const s = new McpServer({ name: "sql-server-dba", version: "1.0.0" });
  registerTools(s);
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP layer — Streamable HTTP transport (MCP spec 2025-06-18)
//
// Single /mcp endpoint supporting POST (new session via initialize, or existing
// via Mcp-Session-Id header), GET (SSE stream for server-initiated messages),
// and DELETE (session termination).
//
// VS Code mcp.json example:
//   { "sql-dba": { "type": "http", "url": "http://localhost:3001/mcp" } }
// ─────────────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && transports.has(sessionId)) {
    await transports.get(sessionId)!.handleRequest(req, res, req.body);
    return;
  }

  if (!sessionId && isInitializeRequest(req.body)) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newId) => {
        transports.set(newId, transport);
        console.log(`[mcp] New session: ${newId}`);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        transports.delete(transport.sessionId);
        console.log(`[mcp] Session closed: ${transport.sessionId}`);
      }
    };

    const sessionServer = createServer();
    await sessionServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  res.status(400).json({ error: "Bad request" });
});

app.get("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    res.status(400).json({ error: "Session not found", sessionId });
    return;
  }

  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId) {
    const transport = transports.get(sessionId);
    if (transport) {
      await transport.close();
      transports.delete(sessionId);
    }
  }
  res.status(200).end();
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    server: "sql-server-dba-mcp",
    version: "1.0.0",
    sessions: transports.size,
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`SQL Server DBA MCP server started`);
  console.log(`  MCP endpoint:    http://localhost:${PORT}/mcp`);
  console.log(`  Health check:    http://localhost:${PORT}/health`);
  console.log(`  SQL_SERVER:      ${process.env.SQL_SERVER ?? "sqlserver"}`);
  console.log(`  SQL_USER:        ${process.env.SQL_USER ?? "dba_monitor"}`);
});
