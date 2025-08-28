# Next.js Pages Backup Restoration Instructions

Created: Thu, Aug 28, 2025  7:44:27 PM
Phase: 3.2.1 - Pre-cleanup backup

## Backup Contents

### Pages Backup
- File: docs/backups/nextjs-pages-backup-20250828_194426.tar.gz
- Contains: apps/web/src/app/ directory
- Size: 32K

### Config Backup  
- File: docs/backups/nextjs-config-backup-20250828_194426.tar.gz
- Contains: next.config.mjs, next-env.d.ts
- Location: apps/web/

## Restoration Commands

To restore Next.js pages if needed:

```bash
# Restore app directory
tar -xzf "docs/backups/nextjs-pages-backup-20250828_194426.tar.gz"

# Restore config files (if they exist)
if [ -f "docs/backups/nextjs-config-backup-20250828_194426.tar.gz" ]; then
    tar -xzf "docs/backups/nextjs-config-backup-20250828_194426.tar.gz" -C apps/web/
fi
```

## Verification

After restoration, verify with:
```bash
ls -la apps/web/src/app/
ls -la apps/web/next*
```

## Note

These files were unused legacy components. TanStack Router handles all routing functionality.
Restoration should only be needed for reference purposes.
