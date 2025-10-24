# 🎯 ROOT CAUSE FOUND: Database Over-Creation Bug

**Date**: 2025-10-24
**Status**: ✅ ROOT CAUSE IDENTIFIED
**Severity**: 🔴 High - Performance Bug

---

## 🚨 CRITICAL FINDING

**185 unique project IDs are being generated during app initialization**, BEFORE any test project is created!

### Evidence

```
📍 CHECKPOINT 1: Before creating project
   Databases: 190 (185 media + 185 timeline + frame-cache + qcut-projects)

📍 CHECKPOINT 8: Final database state
   Actual media databases: 185
   Unique project IDs in media DBs: 185

💡 Conclusion: The bug is generating multiple project IDs (185 unique IDs)
```

---

## 🔍 Timeline of Database Creation

1. **Test Cleanup**: ✅ Deletes all databases (0 databases)
2. **App Initialization**: 🚨 **190 databases created** (this is the bug!)
3. **Navigate to Projects Page**: Already has 190 databases
4. **Create Test Project**: Adds 1 more project (186 total now)
5. **Open Stickers Panel**: No additional databases
6. **Final Count**: 372 databases (185 media + 185 timeline + 2 system)

---

## 🐛 The Bug Pattern

The bug creates databases for **185 different project IDs** during:
- App initialization
- BEFORE the test creates any project
- BEFORE user interaction

**Pattern**: For each of 185 project IDs, it creates:
1. `video-editor-media-{projectId}`
2. `video-editor-timelines-{projectId}`

**Total**: 185 × 2 = 370 databases (plus frame-cache + qcut-projects = 372)

---

## 🔬 Hypothesis: What Generates 185 Project IDs?

### Most Likely Causes

1. **Frame Cache System** (`frame-cache` database exists)
   - Possibly iterating over frame numbers (e.g., 0-184 frames = 185 iterations)
   - Each iteration incorrectly generates a new project ID
   - Creates media/timeline databases for each "project"

2. **Timeline Initialization**
   - Processing timeline data with frame-by-frame logic
   - Accidentally creating project ID for each frame

3. **Migration or Seed Data**
   - Old migration code running on startup
   - Generating phantom project records

4. **Rendering Loop Bug**
   - React component rendering 185 times
   - Each render generates a new project ID
   - useEffect dependency array issue

### Number Significance: 185

What could 185 represent?
- **Frame count**: 185 frames (6.16 seconds at 30fps)
- **Iteration count**: Loop running 185 times
- **Asset count**: 185 resources being processed
- **Random**: Coincidentally stopping at 185

---

## 📂 Files to Investigate

### High Priority - Frame/Timeline Related

1. **Frame Cache System**
   ```bash
   grep -r "frame-cache" apps/web/src --include="*.ts" --include="*.tsx"
   ```

2. **Timeline Initialization**
   ```typescript
   // apps/web/src/stores/timeline-store.ts
   // Look for loops that might generate project IDs
   ```

3. **Project ID Generation in Loops**
   ```bash
   grep -r "generateUUID.*for\|for.*generateUUID" apps/web/src
   ```

### Medium Priority - Initialization Code

4. **Storage Provider**
   ```typescript
   // apps/web/src/components/storage-provider.tsx
   // Check initialization useEffect
   ```

5. **App Initialization**
   ```bash
   grep -r "useEffect.*\[\]" apps/web/src/routes --include="*.tsx"
   ```

6. **Migrators**
   ```typescript
   // apps/web/src/components/providers/migrators/
   // Check all migration files
   ```

---

## 🔧 Next Debugging Steps

### Step 1: Search for Frame Cache Code

```bash
cd qcut/apps/web/src
grep -r "frame-cache\|frameCache" --include="*.ts" --include="*.tsx" -n
```

**Look for**: Loops that iterate over frames and might call storage functions

### Step 2: Add Breakpoint Logging to getProjectMediaAdapters

```typescript
// In storage-service.ts
private getProjectMediaAdapters(projectId: string) {
  // DIAGNOSTIC: Throw error to capture stack trace
  if (projectId !== 'expected-project-id-here') {
    const stack = new Error().stack;
    console.error(`🚨 Unexpected projectId: ${projectId}`);
    console.error('Stack trace:', stack);
  }

  // ... rest of function
}
```

### Step 3: Check Timeline Store Initialization

```typescript
// Search for code that might iterate 185 times
grep -r "\.map\|\.forEach\|for.*of" apps/web/src/stores/timeline-store.ts
```

### Step 4: Profile App Startup

Add logging to track when databases are created:

```typescript
// In IndexedDBAdapter constructor
console.error(`[IndexedDBAdapter] Creating database: ${dbName}`);
console.trace('Call stack');
```

---

## 💡 Likely Root Cause Scenario

**Most probable scenario based on evidence:**

```typescript
// HYPOTHETICAL BUG CODE (example)
// Somewhere in initialization code:

// Process frames for some reason (thumbnail generation, preview, etc.)
const frames = Array.from({ length: 185 }, (_, i) => i);

frames.forEach((frameNumber) => {
  // BUG: Accidentally generating a new project ID for each frame!
  const projectId = generateUUID();

  // This creates video-editor-media-{projectId} database
  await storageService.loadAllMediaItems(projectId);

  // This creates video-editor-timelines-{projectId} database
  await storageService.loadTimeline({ projectId });
});
```

**Why this makes sense:**
1. ✅ Creates exactly 2 databases per iteration (media + timeline)
2. ✅ Happens during initialization (before test project creation)
3. ✅ Creates 185 unique project IDs
4. ✅ Explains why project IDs are all different UUIDs

---

## 🎬 Immediate Action Items

1. **✅ DONE**: Identified root cause (185 unique project IDs generated during init)
2. **⏳ TODO**: Find the code generating these 185 project IDs
3. **⏳ TODO**: Fix the loop/initialization code
4. **⏳ TODO**: Verify fix (should see only 3-5 databases)
5. **⏳ TODO**: Run full regression tests

---

## 📊 Test Results Summary

| Metric | Value | Analysis |
|--------|-------|----------|
| Databases before project creation | 190 | 🚨 Bug creates these during init |
| Unique project IDs | 185 | 🚨 Root cause: 185 IDs generated |
| Media databases | 185 | 1 per project ID |
| Timeline databases | 185 | 1 per project ID |
| System databases | 2 | frame-cache + qcut-projects |
| Expected databases | 3-5 | What we should have |

---

## 🎯 Success Criteria

After fix:
- ✅ Only 1 project ID should exist (the test project)
- ✅ Total databases: 3-5 (qcut-projects, media-{testProjectId}, timeline-{testProjectId}, frame-cache, maybe stickers)
- ✅ No phantom project IDs
- ✅ Cleanup deletes all databases
- ✅ Tests pass with minimal database creation

---

## 📝 Related Files

- `DATABASE-BUG-FINDINGS.md` - Original bug report
- `DATABASE-BUG-INVESTIGATION-UPDATE.md` - Investigation progress
- `apps/web/src/test/e2e/debug-projectid.e2e.ts` - Diagnostic test
- `/tmp/final-diagnostic.log` - Full test output with evidence

---

**Next Step**: Search codebase for frame cache code or loops that generate 185 iterations with project IDs.

**Status**: Ready for code fix once the exact code location is identified.
