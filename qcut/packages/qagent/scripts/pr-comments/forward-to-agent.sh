#!/bin/bash
# Forward PR review comments to an agent as structured tasks
# Called by the orchestrator when "changes-requested" reaction fires
# Usage: ./forward-to-agent.sh owner/repo pr_number session_data_dir
#
# This script:
# 1. Exports PR comments to structured markdown files
# 2. Preprocesses them into task files
# 3. Analyzes file groupings
# 4. Generates a structured message for the agent with all comments

set -e

REPO=${1:-""}
PR=${2:-""}
DATA_DIR=${3:-""}

if [ -z "$REPO" ] || [ -z "$PR" ]; then
    echo "Usage: ./forward-to-agent.sh owner/repo pr_number [data_dir]"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Use data dir or temp
if [ -z "$DATA_DIR" ]; then
    DATA_DIR=$(mktemp -d)
fi

EXPORT_DIR="${DATA_DIR}/pr-${PR}"
TASKS_DIR="${DATA_DIR}/pr-${PR}-tasks"

# Step 1: Export comments
bash "$SCRIPT_DIR/export.sh" "$REPO" "$PR" "$EXPORT_DIR" > /dev/null 2>&1

# Count exported
COMMENT_COUNT=$(ls -1 "$EXPORT_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ')

if [ "$COMMENT_COUNT" -eq "0" ]; then
    echo "No review comments found on PR #${PR}."
    exit 0
fi

# Step 2: Preprocess into tasks
bash "$SCRIPT_DIR/batch-preprocess.sh" "$EXPORT_DIR" "$TASKS_DIR" > /dev/null 2>&1

# Step 3: Build structured message for the agent
echo "# PR Review Comments — Address These"
echo ""
echo "Your PR #${PR} has **${COMMENT_COUNT} review comment(s)** that need attention."
echo ""
echo "## Processing Instructions"
echo ""
echo "1. **Group fixes by file** — multiple comments may target the same file"
echo "2. **Fix bottom-up** (highest line number first) to avoid line shifts"
echo "3. After fixing, push your changes"
echo "4. Reply to each review comment on GitHub"
echo ""
echo "## Comments"
echo ""

# Output each task file content
for task in "$TASKS_DIR"/*.md; do
    if [ -f "$task" ]; then
        echo "---"
        echo ""
        # Extract key fields
        file_path=$(sed -n 's/.*\*\*File:\*\* `\([^`]*\)`.*/\1/p' "$task" | head -1)
        line_num=$(sed -n 's/.*\*\*Line:\*\* \([0-9]*\).*/\1/p' "$task" | head -1)
        comment_id=$(sed -n 's/.*\*\*Comment ID:\*\* \([0-9]*\).*/\1/p' "$task" | head -1)
        author=$(sed -n 's/.*\*\*Author:\*\* \(.*\)/\1/p' "$task" | head -1)

        echo "### ${file_path}:${line_num} (by ${author})"
        echo ""

        # Get the review body (everything after the --- separator)
        sed -n '/^---$/,$ p' "$task" | tail -n +2
        echo ""
    fi
done

echo ""
echo "## After Fixing"
echo ""
echo "1. \`git add\` changed files"
echo "2. \`git commit -m \"fix: address PR review comments\"\`"
echo "3. \`git push\`"
echo "4. Reply to each comment on GitHub using \`gh api\`"
