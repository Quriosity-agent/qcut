#!/bin/bash
# Agent Orchestrator setup script
# Installs dependencies, builds packages, and links the CLI globally

set -e  # Exit on error

echo "🤖 Agent Orchestrator Setup"
echo ""

# Check for bun
if ! command -v bun &> /dev/null; then
    echo "❌ bun not found. Installing bun..."
    curl -fsSL https://bun.sh/install | bash
    # Add bun to PATH for the rest of this script
    export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
    export PATH="$BUN_INSTALL/bin:$PATH"
fi

echo "📦 Installing dependencies..."
bun install

echo "🧹 Cleaning stale build artifacts..."
rm -rf packages/web/.next

echo "🔨 Building all packages..."
bun run build

echo "🔗 Linking CLI globally..."
cd packages/cli
npm link
cd ../..

echo ""
echo "✅ Setup complete! The 'qagent' command is now available."
echo ""
echo "Next steps:"
echo "  1. cd /path/to/your/project"
echo "  2. qagent init --auto"
echo "  3. gh auth login"
echo "  4. qagent start"
echo ""
