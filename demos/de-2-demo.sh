#!/bin/bash
############################################################################################################
# DATA EXPOSED — SQL Server + GitHub Copilot via MCP
# Demo 2 of 4: MCP Configuration — Wiring Copilot to the Servers (~4 minutes)
#
#   WHAT WE'LL COVER:
#     - The single mcp.json file that registers all MCP servers in VS Code
#     - MCP Streamable HTTP vs legacy SSE transport
#     - Verifying the MCP handshake manually with curl
#     - The tool list: what Copilot can actually call
############################################################################################################


############################################################################################################
# The one file that wires everything together — user-level, applies to all workspaces
############################################################################################################

code "$HOME/Library/Application Support/Code/User/mcp.json"


############################################################################################################
#
#  mcp.json — two servers registered
#
#  {
#    "servers": {
#      "sql-dba": {
#        "type": "http",
#        "url":  "http://localhost:3001/mcp"
#      },
#      "products-db": {
#        "type": "http",
#        "url":  "http://localhost:5001/mcp"
#      }
#    }
#  }
#
#  type "http" = MCP Streamable HTTP (2025-06-18 spec) — the current standard
#  type "sse"  = legacy transport, avoid for new servers
#
#  That's it. No plugins. No extensions. No API keys.
#  VS Code discovers and calls the tools automatically once registered here.
#
############################################################################################################


############################################################################################################
# Verify the sql-dba MCP server with a raw JSON-RPC initialize call
# This is the exact handshake VS Code sends when agent mode starts
############################################################################################################

curl -si -X POST http://localhost:3001/mcp \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{
          "jsonrpc": "2.0",
          "id":      1,
          "method":  "initialize",
          "params":  {
            "protocolVersion": "2025-06-18",
            "capabilities":    {},
            "clientInfo":      { "name": "demo", "version": "1" }
          }
        }'

# Look for in the response:
#   Mcp-Session-Id   — session token (subsequent requests use this header)
#   protocolVersion  — negotiated version
#   serverInfo.name  — "sql-server-dba"


############################################################################################################
# Ask the server what tools it exposes — the full tool catalogue
############################################################################################################

SESSION=$(curl -si -X POST http://localhost:3001/mcp \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"demo","version":"1"}}}' \
    | grep -i "mcp-session-id" | awk '{print $2}' | tr -d '\r')

curl -s -X POST http://localhost:3001/mcp \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Mcp-Session-Id: $SESSION" \
    -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
    | grep '^data: ' | sed 's/^data: //' \
    | jq '[.result.tools[] | {name, description: .description[:80]}]'

# 28 tools — covering: sessions, blocking, wait stats, query store, indexes,
#             memory, tempdb, I/O, jobs, AG health, and more


############################################################################################################
# Same for the DAB products-db server
############################################################################################################

DAB_SESSION=$(curl -si -X POST http://localhost:5001/mcp \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"demo","version":"1"}}}' \
    | grep -i "mcp-session-id" | awk '{print $2}' | tr -d '\r')

curl -s -X POST http://localhost:5001/mcp \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Mcp-Session-Id: $DAB_SESSION" \
    -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
    | grep '^data: ' | sed 's/^data: //' \
    | jq '[.result.tools[] | {name, description: .description[:80]}]'

# DAB exposes one tool per entity: Products, Categories, Orders, OrderDetails
# Each tool supports list, get-by-pk, create, update, delete — full CRUD via MCP


############################################################################################################
# In VS Code — open agent mode and verify both servers show as connected
#
#   1. Click the Copilot icon → open Chat
#   2. Switch to Agent mode (not Ask, not Edit)
#   3. Click the tools icon (wrench) — you should see:
#        sql-dba        → 28 tools (list_instances, get_server_info, get_wait_stats, ...)
#        products-db    → entity tools (Products, Categories, Orders, OrderDetails)
#
############################################################################################################


############################################################################################################
# First agent prompt — confirm Copilot can reach the servers and understands the tools
#
#   Ask in Copilot Chat (Agent mode):
#
#     "What SQL Server instances are available and what MCP tools can you use to monitor them?"
#
#   Tools invoked: list_instances
#   Watch for: Copilot listing SqlServer1 and SqlServer2 by name,
#              then describing the available diagnostic tools
############################################################################################################
