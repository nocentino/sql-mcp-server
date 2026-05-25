#!/bin/bash
############################################################################################################
# 1. The Architecture — Your SQL Server, Talking to an AI Agent
#    Model Context Protocol (MCP) lets GitHub Copilot call your own servers as tools.
#    We have two MCP servers:
#      - sql-dba  : 28 DMV-backed diagnostic tools, full T-SQL read access
#      - products-db : Data API Builder — natural-language CRUD over ProductsDB
#
#    The AI never touches the database directly.
#    It calls your tool server. Your tool server runs the SQL. You stay in control.
############################################################################################################


############################################################################################################
#
#  ARCHITECTURE OVERVIEW
#
#    ┌─────────────────────────────────────────────┐
#    │              GitHub Copilot                 │
#    │            (VS Code Chat Panel)             │
#    └──────────────┬──────────────────────────────┘
#                   │  MCP (Streamable HTTP)
#          ┌────────┴────────┐
#          │                 │
#          ▼                 ▼
#   ┌─────────────┐   ┌─────────────────┐
#   │  sql-dba    │   │  products-db    │
#   │  port 3001  │   │  port 5001      │
#   │  28 tools   │   │  DAB / REST     │
#   └──────┬──────┘   └───────┬─────────┘
#          │                  │
#          └─────────┬────────┘
#                    │  T-SQL  (port 1433)
#                    ▼
#          ┌─────────────────┐
#          │  SQL Server     │
#          │  2025 Developer │
#          │  ProductsDB     │
#          └─────────────────┘
#
############################################################################################################


############################################################################################################
# Review the project structure
############################################################################################################

# Open the project root in VS Code
code /Users/aen/Desktop/sql-mcp


############################################################################################################
# Review the docker-compose.yml
# Four services: sqlserver, sql-init, dab-mcp, sql-mcp-server
############################################################################################################

code docker-compose.yml


############################################################################################################
# Start the environment
############################################################################################################

# Pull images and start all four services
docker compose up -d


############################################################################################################
# Watch the startup sequence
# sql-init runs once, seeds ProductsDB, creates dba_monitor login, then exits
############################################################################################################

docker compose logs -f


############################################################################################################
# Verify all containers are healthy before the demo
############################################################################################################

docker compose ps


############################################################################################################
# Check the sql-dba MCP server health endpoint
############################################################################################################

curl http://localhost:3001/health


############################################################################################################
# Check the DAB (products-db) health endpoint
############################################################################################################

curl http://localhost:5001/health


############################################################################################################
# Confirm SQL Server is running and check the version
############################################################################################################

docker exec sql-mcp-sqlserver1 /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P 'S0methingS@Str0ng!' -C \
    -Q "SELECT @@VERSION"


############################################################################################################
# Look at the databases that were created by sql-init
############################################################################################################

docker exec sql-mcp-sqlserver1 /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P 'S0methingS@Str0ng!' -C \
    -Q "SELECT name, state_desc, recovery_model_desc FROM sys.databases ORDER BY name"
