#!/bin/bash
# Test runner script for CI/CD integration

set -e  # Exit on error

echo "🧪 Running QCut Test Suite..."
echo "================================"

# Navigate to web app directory
cd "$(dirname "$0")/../apps/web" || exit 1

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  bun install
fi

# Run linting
echo ""
echo "🔍 Running linter..."
bun run lint:clean || echo "⚠️  Lint warnings found"

# Run type checking
echo ""
echo "📝 Running type check..."
bun run check-types || echo "⚠️  Type errors found"

# Run tests with coverage
echo ""
echo "🧪 Running tests..."
bun test --coverage

# Generate coverage report
echo ""
echo "📊 Test Coverage Summary:"
bun test:coverage --reporter=text-summary

echo ""
echo "✅ Test suite completed!"