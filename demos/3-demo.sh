#!/bin/bash
############################################################################################################
# 3. Data API Builder — REST, GraphQL & Agentic Access
#    DAB sits in front of SQL Server and exposes ProductsDB as a full REST API,
#    a GraphQL endpoint, and an MCP server — no SQL required from the caller.
############################################################################################################


############################################################################################################
# SCENARIO 1 — REST CRUD
# DAB is running on http://localhost:5001 and exposes /api/<entity>
# All four tables are available: Products, Categories, Orders, OrderDetails
############################################################################################################

# List all products (response is a JSON object with a "value" array)
curl -s "http://localhost:5001/api/Products" | jq '[.value[] | {ProductID, ProductName, Category, UnitPrice}]'

# Filter — Electronics only (OData $filter; spaces encoded as %20)
curl -s "http://localhost:5001/api/Products?\$filter=Category%20eq%20'Electronics'" | jq '[.value[] | {ProductID, ProductName, UnitPrice}]'

# Sort + paginate — top 5 most expensive products ($first=N, not $top, in DAB)
curl -s "http://localhost:5001/api/Products?\$orderby=UnitPrice%20desc&\$first=5" | jq '[.value[] | {ProductName, Category, UnitPrice}]'

# Create — POST a new product; capture the generated ProductID
NEW_ID=$(curl -s -X POST "http://localhost:5001/api/Products" \
    -H "Content-Type: application/json" \
    -d '{"ProductName":"Smart Speaker","Category":"Electronics","UnitPrice":79.99,"UnitsInStock":50,"Discontinued":false}' \
    | jq '.value[0].ProductID')
echo "Created ProductID: $NEW_ID"

# Read the new record back by primary key
curl -s "http://localhost:5001/api/Products/ProductID/$NEW_ID" | jq '.value[0]'

# Update — apply a 10 % price increase via PATCH
curl -s -X PATCH "http://localhost:5001/api/Products/ProductID/$NEW_ID" \
    -H "Content-Type: application/json" \
    -d '{"UnitPrice":87.99}' | jq '.value[0] | {ProductID, ProductName, UnitPrice}'

# Delete — clean up the demo record
curl -s -X DELETE "http://localhost:5001/api/Products/ProductID/$NEW_ID"
echo "Deleted ProductID: $NEW_ID"


############################################################################################################
# SCENARIO 2 — GraphQL
# Same entities, same permissions — choose REST or GraphQL depending on your client.
# GraphQL endpoint: POST http://localhost:5001/graphql
############################################################################################################

# Filter Electronics via GraphQL field filter syntax
curl -s -X POST "http://localhost:5001/graphql" \
    -H "Content-Type: application/json" \
    -d '{"query":"{ products(filter: { Category: { eq: \"Electronics\" } }) { items { ProductID ProductName UnitPrice UnitsInStock } } }"}' \
    | jq '.data.products.items'

# Average price per category (group_by handled client-side with jq)
curl -s -X POST "http://localhost:5001/graphql" \
    -H "Content-Type: application/json" \
    -d '{"query":"{ products { items { Category UnitPrice } } }"}' \
    | jq '[.data.products.items | group_by(.Category)[] | {Category: .[0].Category, AvgPrice: ([.[].UnitPrice] | add / length | . * 100 | round / 100)}]'


############################################################################################################
# SCENARIO 3 — Agentic Access via DAB MCP
# DAB exposes an MCP endpoint at /mcp. VS Code already has it registered
# as the "products-db" server in your user-level mcp.json:
#
#   "products-db": { "type": "http", "url": "http://127.0.0.1:5001/mcp" }
#
# Copilot can now read and write data through natural language — no SQL, no curl,
# no schema knowledge required from the user.
############################################################################################################

# In Copilot Chat (agent mode), ask:
#
#   Show me all products with fewer than 50 units in stock, sorted by stock level.
#   Which categories are most at risk of running out?
#
# Tools invoked: products-db (DAB MCP → REST → SQL)
# Watch for: Copilot using the products-db MCP tool, not the sql-dba tool
# Expect: Standing Desk (15), Bookshelf (20), Air Purifier (25), Office Chair (30)
#         — Furniture is the exposed category, not Electronics

# Then ask:
#
#   We're running a summer sale. Apply a 15% discount to all Furniture products.
#   Show me the before and after prices.
#
# Tools invoked: products-db list → products-db update (PATCH per item)
# Watch for: Copilot iterating over results and issuing individual PATCH calls
#            through the DAB REST layer — no direct SQL UPDATE

# Then ask:
#
#   A customer wants to reorder everything from Order 1.
#   What products were in that order, what are the current prices,
#   and are they all still in stock?
#
# Tools invoked: products-db (OrderDetails + Products via DAB)
# Watch for: Copilot correlating two entities through the MCP tools
# Expect: Laptop Pro 15 (qty 1, $1,299.99) + Wireless Mouse (qty 2, $29.99)
#         — both in stock, prices unchanged since original order

