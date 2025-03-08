#!/bin/bash

# Exit on error
set -e

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '#' | sed 's/\r$//' | awk '/=/ {print $1}' )
fi

# Set VITE_PUBLIC_SERVER from ZERO_SERVER_URL
export VITE_PUBLIC_SERVER="${ZERO_SERVER_URL}"

echo "Generating permissions SQL..."
bunx zero-deploy-permissions \
  --schema-path='./queries/schema.ts' \
  --output-file='./sync-server/permissions.sql'

echo "Permissions deployed successfully!" 