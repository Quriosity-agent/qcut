# Database Over-Creation Bug - Investigation Update

**Date**: 2025-10-24
**Status**: 🔴 ROOT CAUSE STILL UNIDENTIFIED - Narrowed down but needs deeper debugging
**Severity**: High - Performance Impact

---

## 🎯 Investigation Summary

After extensive debugging with targeted logging and diagnostic tests, we have narrowed down the bug significantly but have not yet identified the exact root cause.

### ✅ What We've Confirmed

1. **Bug Occurs During Project Initialization**
   - 363-369 databases created in EACH test run
   - Bug triggers when creating a project and opening the editor
   - **Does NOT require any sticker clicks** - happens before any user interaction

2. **Not a Cleanup Issue**
   - Test cleanup works perfectly (deletes all databases after each test)
   - Each test starts with clean slate (0 databases)
   - Problem is NOT cross-test contamination

3. **Project ID is Stable**
   - Test creates 1 project with stable UUID (e.g., `940fbfe2-ab2e-4b9f-895b-eb112c504793`)
   - ActiveProject.id remains consistent throughout test
   - No evidence of project ID being regenerated

4. **Database Names Have Unique UUIDs**
   - Pattern: `video-editor-media-{UUID}`
   - 300+ different UUIDs in database names
   - Suggests `getProjectMediaAdapters(projectId)` is called 300+ times with different projectId values

5. **BlobUrlCleanup is NOT the Culprit**
   - Verified: Migrator processes ≤5 projects
   - Not causing the excessive database creation

### ❌ What We've Ruled Out

- ✅ Cross-test database accumulation
- ✅ Sticker selection code
- ✅ BlobUrlCleanup migrator
- ✅ loadAllProjects returning 300+ projects
- ✅ Parameter swap bugs in saveMediaItem calls

---

## 🔬 Diagnostic Work Performed

### Files Modified with Debug Logging

1. **`storage-service.ts`**
   ```typescript
   // Line 219: Added logging in saveMediaItem
   console.log(`[StorageService.saveMediaItem] Called with projectId: ${projectId}, mediaItem.id: ${mediaItem.id}`);

   // Line 86-87: Added logging in getProjectMediaAdapters
   console.log(`[StorageService] getProjectMediaAdapters called with projectId: ${projectId}`);
   console.trace('[StorageService] Call stack');

   // Line 197-204: Added logging in loadAllProjects
   console.error(`[StorageService.loadAllProjects] Found ${projectIds.length} project IDs to load`);
   ```

2. **`media-store.ts`**
   ```typescript
   // Line 325-326: Added logging in addMediaItem
   console.log(`[MediaStore.addMediaItem] Called with projectId: ${projectId}, item.name: ${item.name}`);
   ```

3. **`use-sticker-select.ts`**
   ```typescript
   // Line 29-30: Added logging for activeProject.id
   console.log(`[StickerSelect] activeProject.id = ${activeProject.id}, iconId = ${iconId}`);
   ```

4. **`blob-url-cleanup.tsx`**
   ```typescript
   // Line 33-39: Added diagnostic error throwing
   if (projects.length > 5) {
     throw new Error(`BlobUrlCleanup DIAGNOSTIC: Found ${projects.length} projects!`);
   }
   ```

### Test Results

#### Debug Test (`debug-projectid.e2e.ts`)
- Created test to track projectId throughout execution
- **Result**: Single stable projectId, but 367 databases created
- **Stickers**: 0 loaded (panel empty)
- **Console logs**: Not captured by Playwright (technical limitation)

---

## 🤔 Leading Hypothesis

The most likely scenario based on evidence:

**Somewhere in the codebase, there is code that:**
1. Generates or retrieves a list of ~300-360 IDs (possibly legacy data, garbage data, or computed IDs)
2. For each ID, calls `getProjectMediaAdapters(id)` or a function that leads to it
3. This creates a database `video-editor-media-{id}` for each

**Possible locations:**
- Hidden initialization code that runs on app startup
- Background worker or service scanning for projects
- Component rendering loop with incorrect dependency array
- Migration or data seeding code
- Frame cache or thumbnail generation system iterating incorrectly

---

## 🔍 Next Investigation Steps

### High Priority

1. **Enable Browser DevTools Console Logging in E2E Tests**
   - Current challenge: Console logs from renderer process not captured by Playwright
   - **Solution**: Modify electron-helpers.ts to add page.on('console', ...) listener
   - This will make all our debug logs visible

2. **Add Page Evaluation Diagnostics**
   - Instead of relying on console.log, use page.evaluate() to get diagnostic data
   - Example:
   ```typescript
   const dbStats = await page.evaluate(async () => {
     const dbs = await indexedDB.databases();
     return {
       total: dbs.length,
       mediaDbNames: dbs.filter(db => db.name?.startsWith('video-editor-media-')).map(db => db.name)
     };
   });
   console.log('Database count:', dbStats.total);
   console.log('Media databases:', dbStats.mediaDbNames);
   ```

3. **Profile Database Creation Timeline**
   - Add timestamps to getProjectMediaAdapters calls
   - Determine when in the lifecycle the 300+ databases are created
   - Are they created:
     - During storage initialization?
     - During project loading?
     - During media loading?
     - During UI rendering?

4. **Inspect qcut-projects Database Contents**
   - Use page.evaluate to read actual contents of qcut-projects database
   - Verify it only contains 1 project record (as expected)
   - Check for any phantom/garbage records

5. **Trace getProjectMediaAdapters Call Sites**
   - Add Error().stack capture in getProjectMediaAdapters
   - Log the stack trace to identify where calls originate
   - Pattern match to find if there's a loop

### Medium Priority

6. **Check Frame Cache System**
   - Database sample showed `frame-cache` database
   - Investigate if frame cache is somehow triggering media database creation
   - File: Search for "frame-cache" in codebase

7. **Review All Migration Code**
   - scenes-migrator.tsx - Already checked
   - Any other migrators? Search for `Migrator` pattern
   - Check if migrations run on every app load

8. **Analyze loadAllProjects Flow**
   - Add breakpoint-style logging to track execution:
     ```typescript
     console.error('CHECKPOINT 1: Before loadAllProjects');
     const projects = await storageService.loadAllProjects();
     console.error('CHECKPOINT 2: After loadAllProjects, count:', projects.length);
     ```

### Low Priority

9. **Search for Loops Over Arrays of ~300 Items**
   - `grep -r "\.map\|\.forEach\|for.*of" --include="*.ts" --include="*.tsx"`
   - Filter for suspicious patterns with large arrays

10. **Review OPFS Adapter**
    - OPFSAdapter also creates `media-files-{projectId}` directories
    - Check if OPFS is somehow involved in the bug

---

## 💡 Temporary Workarounds

While investigating, consider these mitigations:

### Option 1: Disable Problematic Features in Tests
```typescript
// In electron-helpers.ts beforeEach
await page.evaluate(() => {
  // Disable migrations during tests
  sessionStorage.setItem('blob-url-cleanup-v1', 'true');
  sessionStorage.setItem('disable-auto-migrations', 'true');
});
```

### Option 2: Enhanced Cleanup
```typescript
// More aggressive cleanup that also clears project records
await page.evaluate(async () => {
  // Delete qcut-projects database BEFORE general cleanup
  await new Promise(resolve => {
    const req = indexedDB.deleteDatabase('qcut-projects');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve(); // Resolve anyway
  });
});
```

### Option 3: Database Creation Limit Check
```typescript
// In getProjectMediaAdapters, add safeguard
private createdDatabases = new Set<string>();

private getProjectMediaAdapters(projectId: string) {
  const dbName = `${this.config.mediaDb}-${projectId}`;

  // SAFEGUARD: Prevent creating >10 databases in one session
  if (!this.createdDatabases.has(dbName)) {
    this.createdDatabases.add(dbName);
    if (this.createdDatabases.size > 10) {
      console.error(`⚠️ SAFEGUARD: Prevented creating database #${this.createdDatabases.size}: ${dbName}`);
      throw new Error(`Database creation limit exceeded (${this.createdDatabases.size} databases). Possible bug!`);
    }
  }

  // ... rest of function
}
```

---

## 📊 Evidence Summary

| Metric | Value | Significance |
|--------|-------|--------------|
| Databases created per test | 363-369 | Consistent, but varies slightly |
| Expected databases per test | 3-5 | Project + media + timeline + cache |
| Database name pattern | `video-editor-media-{UUID}` | Each has unique UUID |
| Project ID stability | ✅ Stable | Single UUID throughout test |
| Cleanup effectiveness | ✅ 100% | All databases deleted after test |
| BlobUrlCleanup project count | ≤5 | Not the cause |
| Test pass rate | 100% (6/6) | Bug doesn't break functionality |

---

## 🎬 Recommended Action Plan

**Phase 1: Capture Console Logs (Highest Impact)**
1. Fix Playwright console capture in electron-helpers.ts
2. Re-run debug test to see all console.log/error output
3. Analyze which code paths are being hit 300+ times

**Phase 2: Database Inspection**
1. Add page.evaluate diagnostics to inspect database contents
2. Verify qcut-projects has only 1 record
3. Track database creation timeline

**Phase 3: Stack Trace Analysis**
1. Modify getProjectMediaAdapters to log call stacks
2. Identify the call pattern (loop vs scattered calls)
3. Trace back to origin

**Phase 4: Root Cause Fix**
1. Once identified, implement proper fix
2. Verify with E2E tests (should see 3-5 databases)
3. Run full regression suite

---

## 📁 Related Files

### Investigation Code
- `apps/web/src/test/e2e/debug-projectid.e2e.ts` - Diagnostic test
- `docs/issues/e2e-test-errors/DATABASE-BUG-FINDINGS.md` - Original bug report

### Modified for Debugging
- `apps/web/src/lib/storage/storage-service.ts` - Added extensive logging
- `apps/web/src/stores/media-store.ts` - Added projectId logging
- `apps/web/src/components/editor/media-panel/views/stickers/hooks/use-sticker-select.ts` - Added activeProject.id logging
- `apps/web/src/components/providers/migrators/blob-url-cleanup.tsx` - Added diagnostic error

### Key Files to Review Next
- `apps/web/src/lib/storage/indexeddb-adapter.ts` - Database creation
- `apps/web/src/lib/storage/opfs-adapter.ts` - File storage
- `apps/web/src/components/storage-provider.tsx` - Storage initialization
- Search results: Any file with loops over project/media IDs

---

**Status**: Investigation ongoing. Root cause not yet identified, but significantly narrowed down.
**Impact**: Tests pass but create excessive databases (performance concern, not functionality blocker)
**Next Step**: Fix Playwright console capture to see debug logs, then trace call stacks
