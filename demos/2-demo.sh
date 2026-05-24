#!/bin/bash
############################################################################################################
# 2. Wiring Copilot to the MCP Servers
#    MCP uses a single JSON file to tell VS Code where your tool servers live.
#    Once registered, every tool the server exposes becomes a callable function
#    for the AI agent — automatically, with no plugins or extensions required.
############################################################################################################


############################################################################################################
# Open the user-level MCP configuration file
# This is where VS Code discovers all MCP servers available in every workspace
############################################################################################################

code "$HOME/Library/Application Support/Code/User/mcp.json"


############################################################################################################
#
#  mcp.json — two servers, one file
#
#  {
#    "servers": {
#      "products-db": {
#        "type": "http",
#        "url":  "http://localhost:5001/mcp"   ← DAB Streamable HTTP
#      },
#      "sql-dba": {
#        "type": "http",
#        "url":  "http://localhost:3001/mcp"   ← our DBA server
#      }
#    }
#  }
#
#  type: "http"  = MCP Streamable HTTP transport (spec 2025-06-18)
#  type: "sse"   = legacy transport — don't use this anymore
#
############################################################################################################


############################################################################################################
# Manually verify the sql-dba MCP endpoint with a raw initialize handshake
# This is exactly what VS Code sends when it first connects
############################################################################################################

curl -s -X POST http://localhost:3001/mcp \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{
          "jsonrpc": "2.0",
          "id":      1,
          "method":  "initialize",
          "params":  {
            "protocolVersion": "2025-06-18",
            "capabilities":    {},
            "clientInfo":      { "name": "curl-test", "version": "1" }
          }
        }'


############################################################################################################
# The response includes:
#   protocolVersion — what version the server negotiated
#   serverInfo.name — "sql-server-dba"
#   Mcp-Session-Id header — session token for all subsequent requests
############################################################################################################


############################################################################################################
# Same test against the DAB products-db server
############################################################################################################

curl -s -X POST http://localhost:5001/mcp \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{
          "jsonrpc": "2.0",
          "id":      1,
          "method":  "initialize",
          "params":  {
            "protocolVersion": "2025-06-18",
            "capabilities":    {},
            "clientInfo":      { "name": "curl-test", "version": "1" }
          }
        }'


############################################################################################################
# Look at the source code for the MCP transport layer
# index.ts: single /mcp endpoint, session map, POST/GET/DELETE
############################################################################################################

code sql-mcp-server/src/index.ts


############################################################################################################
# Look at the tool implementations — all 28 DBA diagnostic tools
# Each tool wraps a DMV query and returns structured JSON to the agent
############################################################################################################

code sql-mcp-server/src/tools.ts


############################################################################################################
#
#  REQUEST FLOW — what happens when you ask Copilot "is there any blocking?"
#
#    1.  Copilot decides it needs get_blocking_chains
#    2.  VS Code POSTs a JSON-RPC "tools/call" to http://localhost:3001/mcp
#    3.  sql-mcp-server runs the DMV query against SQL Server
#    4.  Result JSON is streamed back via SSE event
#    5.  Copilot reads the result and writes a human answer
#
#    You never left VS Code.
#    The model never had direct database access.
#
############################################################################################################
