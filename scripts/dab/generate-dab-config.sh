#!/bin/bash

# Generate DAB configuration using DAB CLI
# This script creates a reproducible dab-config.json file

set -e

echo "🔧 Generating Data API Builder configuration..."

# Connection string
CONNECTION_STRING="Server=localhost,1433;Database=ProductsDB;User ID=dab_app;Password=DabP@ss123!;TrustServerCertificate=true"

# Remove existing config if present
if [ -f dab-config.json ]; then
    echo "Removing existing dab-config.json..."
    rm dab-config.json
fi

# Initialize DAB config
echo "Initializing DAB configuration..."
dab init \
    --database-type mssql \
    --connection-string "$CONNECTION_STRING" \
    --host-mode development

# Add entities
echo "Adding Products entity..."
dab add Products \
    --source dbo.Products \
    --source.type table \
    --permissions "anonymous:*" \
    --rest true \
    --graphql "Product:Products"

echo "Adding Categories entity..."
dab add Categories \
    --source dbo.Categories \
    --source.type table \
    --permissions "anonymous:*" \
    --rest true \
    --graphql "Category:Categories"

echo "Adding Orders entity..."
dab add Orders \
    --source dbo.Orders \
    --source.type table \
    --permissions "anonymous:*" \
    --rest true \
    --graphql "Order:Orders"

echo "Adding OrderDetails entity..."
dab add OrderDetails \
    --source dbo.OrderDetails \
    --source.type table \
    --permissions "anonymous:*" \
    --rest true \
    --graphql "OrderDetail:OrderDetails"

# Add semantic descriptions using jq
echo "Adding semantic descriptions..."
if command -v jq &> /dev/null; then
    # Add description to Products
    jq '.entities.Products.description = "Product catalog with current pricing, inventory levels, and category assignments. Use this for product lookups, stock checks, and pricing queries. Each product has a unique ProductID."' dab-config.json > dab-config.tmp.json && mv dab-config.tmp.json dab-config.json
    
    # Add description to Categories
    jq '.entities.Categories.description = "Product category definitions including Electronics, Books, Clothing, and Home & Garden. Use this to understand product organization and category details. Avoid joining to Products directly; filter Products by Category field instead."' dab-config.json > dab-config.tmp.json && mv dab-config.tmp.json dab-config.json
    
    # Add description to Orders
    jq '.entities.Orders.description = "Customer order headers with order dates, customer information, status, and total amounts. Each order may have multiple line items in OrderDetails. Status values: Pending, Shipped, Delivered, Cancelled."' dab-config.json > dab-config.tmp.json && mv dab-config.tmp.json dab-config.json
    
    # Add description to OrderDetails
    jq '.entities.OrderDetails.description = "Individual line items for each order, including product, quantity, and unit price at time of purchase. Always join to Orders via OrderID and Products via ProductID to get complete order information."' dab-config.json > dab-config.tmp.json && mv dab-config.tmp.json dab-config.json
    
    echo "✓ Semantic descriptions added"
else
    echo "⚠️  Warning: jq not found. Semantic descriptions not added."
    echo "   Install jq: brew install jq (macOS) or apt-get install jq (Linux)"
fi

# Replace connection string with environment variable placeholder
echo "Updating connection string to use environment variable..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' 's|"connection-string": ".*"|"connection-string": "@env(\x27MSSQL_CONNECTION_STRING\x27)"|' dab-config.json
else
    sed -i 's|"connection-string": ".*"|"connection-string": "@env(\x27MSSQL_CONNECTION_STRING\x27)"|' dab-config.json
fi

echo ""
echo "✅ DAB configuration generated successfully!"
echo ""
echo "📄 File: dab-config.json"
echo ""
echo "Note: MCP is enabled by default in DAB 1.7+, no additional config needed!"
echo ""
echo "To validate: dab validate"
echo "To start: dab start"
