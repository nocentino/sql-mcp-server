#!/bin/bash
############################################################################################################
# DATA EXPOSED — SQL Server + GitHub Copilot via MCP
# Demo 4 of 4: products-db — Data API Builder MCP (~6 minutes)
#
# Load passwords from .env if not already set in environment
#   WHAT WE'LL COVER:
#     - What DAB is and what it exposes (REST, GraphQL, MCP — all from one config)
#     - Querying ProductsDB through the REST API
#     - The same data accessed via natural language through Copilot
#     - Copilot performing a multi-step write operation (no SQL, no curl)
#
#   MCP SERVER: products-db (http://localhost:5001/mcp)
#   ENTITIES:   Products, Categories, Orders, OrderDetails
############################################################################################################

# Load passwords from .env if not already set in environment
source .env

############################################################################################################
# What is DAB?
#
#   Data API Builder reads a config file (dab-config.json) and exposes each
#   database table as:
#     - a REST endpoint  (/api/<Entity>)
#     - a GraphQL field  (/graphql)
#     - an MCP tool      (/mcp)
#
#   No code. No controller. Point it at SQL Server + your schema and you're done.
#
############################################################################################################

# Review the DAB config — entities, permissions, connection string reference
code dab-config.json


############################################################################################################
# SCENARIO 1 — REST API baseline
# Show that the data is live before Copilot touches it
############################################################################################################

# All products
curl -s "http://localhost:5001/api/Products" | jq '[.value[] | {ProductID, ProductName, Category, UnitPrice}]'



# Filter by category
curl -s "http://localhost:5001/api/Products?\$filter=Category%20eq%20'Electronics'" \
    | jq '[.value[] | {Category, ProductName, UnitPrice, UnitsInStock}]'



# Low-stock items — what we'll use in the Copilot demo
curl -s "http://localhost:5001/api/Products?\$orderby=UnitsInStock%20asc&\$first=5" \
    | jq '[.value[] | {ProductName, Category, UnitsInStock, UnitPrice}]'


############################################################################################################
# SCENARIO 2 — Natural language read
#
#   Ask Copilot (Agent mode):
#
#     "Show me all products with fewer than 50 units in stock, sorted by stock level. Which categories are most at risk of running out?"
#
#   Tools invoked: products-db (DAB MCP → REST GET → SQL SELECT)
#   Watch for:
#     - Copilot calling the DAB MCP tool, not sql-dba
#     - The result: Standing Desk (15), Bookshelf (20), Air Purifier (25), Office Chair (30)
#     - Copilot's synthesis: Furniture is the at-risk category
############################################################################################################


############################################################################################################
# SCENARIO 3 — Multi-step write via natural language
#
#   Ask Copilot:
#
#     "We're running a summer sale. Apply a 15% discount to all Furniture products. Show me the before and after prices."
#
#   Tools invoked:
#     1. products-db list (filter Category = Furniture) → get current prices
#     2. products-db update (PATCH per item) → apply new price
#     3. products-db list again → confirm updated prices
#
#   Watch for:
#     - Copilot iterating over the list result and issuing individual PATCH calls
#     - No SQL written, no curl — pure natural language → MCP → REST → SQL UPDATE
############################################################################################################

# Verify the prices were actually updated in the database
curl -s "http://localhost:5001/api/Products?\$filter=Category%20eq%20'Furniture'" \
    | jq '[.value[] | {ProductName, UnitPrice}]'


############################################################################################################
# SCENARIO 4 — Cross-entity reasoning
#
#   Ask Copilot:
#
#     "A customer wants to reorder everything from Order 1. What products were in that order, what are the current prices, and is everything still in stock?"
#
#   Tools invoked: products-db (OrderDetails + Products — two entities in one turn)
#   Watch for:
#     - Copilot correlating OrderDetails → Products via ProductID
#     - Expected: Laptop Pro 15 (qty 1) + Wireless Mouse (qty 2), both in stock
#     - Copilot surfacing the current price vs order-time price if they differ
############################################################################################################


############################################################################################################
# WRAP UP — What we showed today
#
#   1. Start the full stack in one command          ./start.sh
#   2. Two MCP servers, one mcp.json entry each     mcp.json
#   3. sql-dba: 28 DMV tools, multi-instance        get_blocking_chains, get_wait_stats, ...
#   4. products-db (DAB): REST + GraphQL + MCP       no code, just dab-config.json
#   5. Copilot never touched SQL Server directly
#   6. Passwords live in .env, never in git
#
#   Next steps:
#     - Grab the code - https://github.com/nocentino/sql-mcp-server
#     - Add your own SQL Server instances to INSTANCES in .env
#     - Extend dab-config.json to expose your own tables
#     - Read the docs:  docs/QUICKSTART.md
#     - Star the repo and try it yourself
#
############################################################################################################
