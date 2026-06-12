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
# Open the source file for the tools implementation, inspect how the SQL is generated and results are returned
# Scroll down to get_active_sessions to see a simple example of a tool implementation
############################################################################################################
code ./sql-mcp-server/src/tools.ts


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
