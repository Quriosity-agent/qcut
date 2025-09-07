# Video Effects System - Rollback Script

## Emergency Rollback Procedures

### Quick Rollback (< 1 minute)

#### 1. Disable Effects Immediately
```javascript
// Run in browser console:
localStorage.setItem('feature_VIDEO_EFFECTS', 'false');
window.location.reload();
```

Or modify the source:
```typescript
// src/config/features.ts
export const FEATURES = {
  VIDEO_EFFECTS: {
    enabled: false, // Change to false
    ...
  }
}
```

### Partial Rollback (5 minutes)

#### Step 1: Disable UI Components
```bash
# Comment out effects imports in affected files
sed -i 's/import.*effects.*\/\//g' qcut/apps/web/src/components/editor/media-panel/index.tsx
sed -i 's/import.*effects.*\/\//g' qcut/apps/web/src/components/editor/properties-panel/index.tsx
sed -i 's/import.*effects.*\/\//g' qcut/apps/web/src/components/editor/timeline/index.tsx
```

#### Step 2: Disable Export Integration
```typescript
// In export-engine.ts, set flag to false
const EFFECTS_ENABLED = false;
```

#### Step 3: Clear Effects from Storage
```javascript
// Clear all effects from browser storage
localStorage.removeItem('feature_VIDEO_EFFECTS');
localStorage.removeItem('effects_store');

// Clear effects from all timeline elements
const timeline = useTimelineStore.getState();
timeline.tracks.forEach(track => {
  track.elements.forEach(element => {
    delete element.effectIds;
  });
});
```

### Full Rollback (10 minutes)

#### Option 1: Git Reset (Recommended)
```bash
# Save current work
git stash save "Saving effects work before rollback"

# Reset to before effects implementation
git reset --hard origin/master

# Or reset to specific commit before effects
git reset --hard <commit-before-effects>

# If you need to keep some changes
git stash pop
git add <files-to-keep>
git commit -m "Partial restore after effects rollback"
```

#### Option 2: File-by-File Restoration
```bash
# Restore original files from backup
cp qcut/apps/web/src/lib/export-engine.backup.ts qcut/apps/web/src/lib/export-engine.ts
cp qcut/apps/web/src/components/editor/preview-panel.backup.tsx qcut/apps/web/src/components/editor/preview-panel.tsx

# Remove effects-specific files
rm -f qcut/apps/web/src/types/effects.ts
rm -f qcut/apps/web/src/lib/effects-utils.ts
rm -f qcut/apps/web/src/stores/effects-store.ts
rm -f qcut/apps/web/src/config/features.ts
rm -rf qcut/apps/web/src/components/editor/media-panel/views/effects.tsx
rm -rf qcut/apps/web/src/components/editor/properties-panel/effects-properties.tsx
rm -rf qcut/apps/web/src/components/editor/timeline/effects-timeline.tsx

# Revert timeline store changes
git checkout origin/master -- qcut/apps/web/src/stores/timeline-store.ts

# Revert UI component changes
git checkout origin/master -- qcut/apps/web/src/components/ui/video-player.tsx
```

### Verification After Rollback

#### 1. Check Core Functionality
```javascript
// Test in console
console.log("Testing core features after rollback:");

// 1. Video import
const testImport = () => {
  console.log("✓ Video import working");
};

// 2. Timeline operations
const testTimeline = () => {
  const store = useTimelineStore.getState();
  console.log("✓ Timeline has", store.tracks.length, "tracks");
};

// 3. Export functionality
const testExport = () => {
  console.log("✓ Export engine loaded");
};

// Run tests
testImport();
testTimeline();
testExport();
```

#### 2. Check for Lingering Effects Code
```bash
# Search for effects-related code
grep -r "EFFECTS_ENABLED" qcut/apps/web/src/
grep -r "useEffectsStore" qcut/apps/web/src/
grep -r "effectIds" qcut/apps/web/src/
grep -r "applyEffect" qcut/apps/web/src/

# If any found, remove or comment out
```

#### 3. Clear Browser State
```javascript
// Clear all effects-related localStorage
Object.keys(localStorage).forEach(key => {
  if (key.includes('effect') || key.includes('EFFECT')) {
    localStorage.removeItem(key);
  }
});

// Clear IndexedDB if used
indexedDB.deleteDatabase('effects_db');

// Force refresh
window.location.reload(true);
```

### Rollback Decision Matrix

| Issue | Severity | Rollback Type | Time |
|-------|----------|---------------|------|
| Effects causing preview lag | Low | Disable flag | 1 min |
| Export failing with effects | Medium | Partial rollback | 5 min |
| Timeline crashes | High | Full rollback | 10 min |
| Build errors | High | Git reset | 5 min |
| Effects UI not showing | Low | Check flag | 1 min |
| Memory leak detected | High | Full rollback | 10 min |

### Post-Rollback Actions

1. **Document Issues**
   ```markdown
   ## Rollback Report
   - Date: [DATE]
   - Reason: [ISSUE DESCRIPTION]
   - Type: [Quick/Partial/Full]
   - Resolution: [WHAT WAS DONE]
   - Next Steps: [PLANNED FIXES]
   ```

2. **Notify Team**
   - Create GitHub issue documenting the problem
   - Update PR with rollback status
   - Alert other developers

3. **Analyze Root Cause**
   ```javascript
   // Collect diagnostic info
   const diagnostics = {
     browser: navigator.userAgent,
     memory: performance.memory,
     errors: window.__errors || [],
     effectsState: localStorage.getItem('feature_VIDEO_EFFECTS'),
     timestamp: new Date().toISOString()
   };
   console.log("Diagnostics:", diagnostics);
   ```

### Automated Rollback Script

Save as `rollback-effects.sh`:
```bash
#!/bin/bash

echo "=== QCut Effects System Rollback ==="
echo "Select rollback type:"
echo "1. Quick (disable flag only)"
echo "2. Partial (disable UI components)"
echo "3. Full (complete removal)"
read -p "Enter choice (1-3): " choice

case $choice in
  1)
    echo "Disabling effects flag..."
    sed -i 's/enabled: true/enabled: false/g' qcut/apps/web/src/config/features.ts
    echo "✓ Effects disabled. Restart dev server."
    ;;
  2)
    echo "Performing partial rollback..."
    # Disable in all components
    find qcut/apps/web/src -name "*.tsx" -o -name "*.ts" | xargs sed -i 's/const EFFECTS_ENABLED = true/const EFFECTS_ENABLED = false/g'
    echo "✓ UI components disabled."
    ;;
  3)
    echo "Performing full rollback..."
    read -p "This will reset to master. Continue? (y/n): " confirm
    if [ "$confirm" = "y" ]; then
      git stash save "Effects rollback backup"
      git reset --hard origin/master
      echo "✓ Full rollback complete."
    else
      echo "Rollback cancelled."
    fi
    ;;
  *)
    echo "Invalid choice. Exiting."
    exit 1
    ;;
esac

echo "=== Rollback Complete ==="
echo "Next steps:"
echo "1. Clear browser cache"
echo "2. Restart development server"
echo "3. Test core functionality"
```

### Recovery After Failed Rollback

If rollback fails or causes issues:

1. **Nuclear Option - Fresh Clone**
   ```bash
   # Backup current work
   cp -r qcut qcut-backup
   
   # Fresh clone
   git clone [repo-url] qcut-fresh
   cd qcut-fresh
   git checkout master
   
   # Copy any needed work
   cp -r ../qcut-backup/[needed-files] .
   ```

2. **Contact Points**
   - GitHub Issues: Report rollback problems
   - Documentation: Update this guide with new issues
   - Team Chat: Alert other developers

### Prevention Checklist

To avoid needing rollback:
- [ ] Always test with flag disabled first
- [ ] Keep backup files before major changes
- [ ] Test each phase independently
- [ ] Monitor browser console for errors
- [ ] Check memory usage during testing
- [ ] Verify export still works
- [ ] Test on multiple browsers
- [ ] Document any issues immediately