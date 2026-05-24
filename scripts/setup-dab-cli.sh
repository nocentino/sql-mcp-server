#!/bin/bash

# Setup script for Data API Builder CLI
# Installs DAB CLI if not present and generates configuration

set -e

echo "🚀 Setting up Data API Builder CLI..."
echo ""

# Check if DAB CLI is already installed
if command -v dab &> /dev/null; then
    DAB_VERSION=$(dab --version 2>&1 | head -1)
    echo "✅ DAB CLI already installed: $DAB_VERSION"
else
    echo "📦 DAB CLI not found. Installing..."
    echo ""
    
    # Check if dotnet is available (preferred method)
    if command -v dotnet &> /dev/null; then
        echo "Installing via .NET CLI..."
        dotnet tool install --global Microsoft.DataApiBuilder
        echo "✅ DAB CLI installed via dotnet"
    # Check if npm is available (alternative method)
    elif command -v npm &> /dev/null; then
        echo "Installing via npm..."
        npm install -g @azure/data-api-builder
        echo "✅ DAB CLI installed via npm"
    else
        echo "❌ Error: Neither dotnet nor npm found."
        echo ""
        echo "Please install one of the following:"
        echo ""
        echo "Option 1 - .NET SDK (recommended):"
        echo "  macOS: brew install dotnet"
        echo "  Linux: https://dotnet.microsoft.com/download"
        echo ""
        echo "Option 2 - Node.js/npm:"
        echo "  macOS: brew install node"
        echo "  Linux: https://nodejs.org/"
        echo ""
        exit 1
    fi
    
    # Verify installation
    if command -v dab &> /dev/null; then
        DAB_VERSION=$(dab --version 2>&1 | head -1)
        echo "Installed version: $DAB_VERSION"
    else
        echo "❌ Installation failed. Please install manually."
        exit 1
    fi
fi

echo ""
echo "✅ DAB CLI setup complete!"
echo ""
echo "Next steps:"
echo "  1. Run: ./scripts/generate-dab-config.sh"
echo "  2. Run: ./start.sh"
