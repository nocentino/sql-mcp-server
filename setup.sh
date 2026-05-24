#!/bin/bash

# One-time setup: install DAB CLI and generate dab-config.json
# Only needed if you want to regenerate the DAB config from scratch.
# For normal use, just run: docker compose up --build -d

set -e

echo "Setting up DAB CLI..."
./scripts/setup-dab-cli.sh

echo "Generating dab-config.json..."
./scripts/generate-dab-config.sh

echo ""
echo "Setup complete. Run 'docker compose up --build -d' to start."
