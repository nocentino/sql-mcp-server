#!/bin/bash
############################################################################################################
# DATA EXPOSED — SQL Server + GitHub Copilot via MCP
# Demo 1 of 4: The Architecture & Starting the Environment (~4 minutes)
#
#   WHAT WE'LL COVER:
#     - What MCP is and why it matters for SQL Server
#     - The two MCP servers in this solution (sql-dba, products-db / DAB)
#     - Starting the full environment with docker compose
#     - Verifying everything is healthy before the demos
############################################################################################################


############################################################################################################
#
#  ARCHITECTURE
#
#    ┌──────────────────────────────────────────────┐
#    │              GitHub Copilot                  │
#    │           (VS Code Agent Mode)               │
#    └──────────────┬───────────────────────────────┘
#                   │  MCP Streamable HTTP (JSON-RPC)
#          ┌────────┴────────┐
#          │                 │
#          ▼                 ▼
#   ┌─────────────┐   ┌──────────────────┐
#   │  sql-dba    │   │  products-db     │
#   │  port 3001  │   │  port 5001       │
#   │  28 DMV     │   │  Data API        │
#   │  tools      │   │  Builder (DAB)   │
#   └──────┬──────┘   └────────┬─────────┘
#          │                   │
#          ├───────────────────┘
#          │  T-SQL
#          ├──────────────────────────────┐
#          │  port 1433                   │  port 1434
#          ▼                              ▼
#   ┌─────────────────┐          ┌─────────────────┐
#   │  sqlserver1     │          │  sqlserver2     │
#   │  SQL Server     │          │  SQL Server     │
#   │  2025 Developer │          │  2025 Developer │
#   │  ProductsDB     │          │  (monitoring    │
#   └─────────────────┘          │   target)       │
#                                └─────────────────┘
#
#  KEY POINTS:
#    - Copilot never touches SQL Server directly
#    - MCP is the protocol; the tool servers are YOUR code running locally
#    - sql-dba  → read-only DMV queries, diagnostic tools, multi-instance support
#    - products-db → full CRUD on ProductsDB via DAB REST + MCP
#
############################################################################################################


############################################################################################################
# Review the project structure
############################################################################################################

ls -la


############################################################################################################
# Four services in docker-compose.yml:
#   sqlserver1      — SQL Server 2025 Developer Edition
#   sql-init        — one-shot container: seeds ProductsDB, creates dba_monitor + dab_app logins
#   sql-mcp-server  — the custom DBA MCP server (Node.js / TypeScript)
#   dab-mcp         — Data API Builder MCP server (Microsoft)
############################################################################################################

code docker-compose.yml


############################################################################################################
# Credentials live in .env — never committed to git (.gitignore covers it)
# .env.example shows the shape; copy it and fill in your passwords
############################################################################################################

code .env


############################################################################################################
# Start the full environment
# --build rebuilds the sql-mcp-server image if source has changed
############################################################################################################

./start.sh


############################################################################################################
# Verify all four containers are healthy
# sql-init and sql-init-sqlserver2 will show Exited (0) — that's expected
############################################################################################################

docker compose ps


############################################################################################################
# Quick endpoint check — both MCP servers must respond before Copilot can use them
############################################################################################################

# DAB (products-db)
curl -s http://localhost:5001/health | jq .

# sql-dba
curl -s http://localhost:3001/health | jq .
