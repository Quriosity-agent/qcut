#!/bin/bash

# Phase 3.2.1: Create backup before removal
# Create backup of Next.js pages before removal for rollback safety

echo "📦 Creating backup of Next.js pages before cleanup..."

# Get current date for backup filename
BACKUP_DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="docs/backups/nextjs-pages-backup-${BACKUP_DATE}.tar.gz"

# Create backup of Next.js app directory
if [ -d "apps/web/src/app" ]; then
    echo "🔄 Backing up apps/web/src/app/ directory..."
    tar -czf "$BACKUP_FILE" apps/web/src/app/
    
    if [ $? -eq 0 ]; then
        echo "✅ Next.js pages backed up to: $BACKUP_FILE"
        echo "📊 Backup size: $(du -h "$BACKUP_FILE" | cut -f1)"
        echo "📁 Files backed up:"
        mapfile -t __entries < <(tar -tzf "$BACKUP_FILE")
        printf '%s\n' "${__entries[@]:0:20}"
        if [ "${#__entries[@]}" -gt 20 ]; then
            echo "   ... and $((${#__entries[@]} - 20)) more files"
        fi
    else
        echo "❌ Backup failed!"
        exit 1
    fi
else
    echo "⚠️ apps/web/src/app/ directory not found"
fi

# Also backup Next.js config files
echo "🔄 Backing up Next.js config files..."
CONFIG_BACKUP="docs/backups/nextjs-config-backup-${BACKUP_DATE}.tar.gz"

files=()
[[ -f "apps/web/next.config.mjs" ]] && files+=("next.config.mjs")
[[ -f "apps/web/next-env.d.ts" ]] && files+=("next-env.d.ts")
if ((${#files[@]} > 0)); then
    if tar -czf "$CONFIG_BACKUP" -C apps/web "${files[@]}"; then
        echo "✅ Next.js config files backed up to: $CONFIG_BACKUP (${files[*]})"
    else
        echo "❌ Config backup failed"
        exit 1
    fi
else
    echo "ℹ️ No Next.js config files found to backup"
fi

# Create restoration instructions
cat > "docs/backups/restore-instructions-${BACKUP_DATE}.md" << EOF
# Next.js Pages Backup Restoration Instructions

Created: $(date)
Phase: 3.2.1 - Pre-cleanup backup

## Backup Contents

### Pages Backup
- File: $BACKUP_FILE
- Contains: apps/web/src/app/ directory
- Size: $(du -h "$BACKUP_FILE" | cut -f1)

### Config Backup  
- File: $CONFIG_BACKUP
- Contains: next.config.mjs, next-env.d.ts
- Location: apps/web/

## Restoration Commands

To restore Next.js pages if needed:

\`\`\`bash
# Restore app directory
tar -xzf "$BACKUP_FILE"

# Restore config files (if they exist)
if [ -f "$CONFIG_BACKUP" ]; then
    tar -xzf "$CONFIG_BACKUP" -C apps/web/
fi
\`\`\`

## Verification

After restoration, verify with:
\`\`\`bash
ls -la apps/web/src/app/
ls -la apps/web/next*
\`\`\`

## Note

These files were unused legacy components. TanStack Router handles all routing functionality.
Restoration should only be needed for reference purposes.
EOF

echo "📋 Restoration instructions created: docs/backups/restore-instructions-${BACKUP_DATE}.md"
echo "🎯 Backup phase complete - ready for cleanup!"

exit 0