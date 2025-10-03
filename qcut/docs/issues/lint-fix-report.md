# Lint Fix Report

**Date**: 2025-10-03
**Branch**: lint-fix-sth
**Command**: `bun run lint:clean`

## Summary

- **Files Checked**: 658
- **Total Errors**: 72
- **Total Warnings**: 36
- **Diagnostics Shown**: Limited (93 diagnostics not shown due to limit)
- **Time**: 35 seconds
- **Fixes Applied**: 0 (dry run)

## Major Issues Found

### 1. Exhaustive Dependencies (2 issues)
**File**: `apps\web\src\components\editor\draw\canvas\drawing-canvas.tsx`

#### Issue 1 (Line 280)
- **Problem**: `onDrawingEnd` callback specifies `objects.length` as unnecessary dependency
- **Type**: `lint/correctness/useExhaustiveDependencies`
- **Fixable**: Yes (auto-fix available)

#### Issue 2 (Line 611)
- **Problem**: `loadDrawingFromDataUrl` specifies `addImageObject` and `clearAll` as unnecessary dependencies
- **Type**: `lint/correctness/useExhaustiveDependencies`
- **Fixable**: Yes (auto-fix available)

### 2. Numeric Separators (4 issues)
**File**: `apps\web\grayscale-converter.ts`

- **Lines**: 98 (2 occurrences), 98 (2 occurrences), 99 (2 occurrences)
- **Problem**: Long numeric literals (20000, 20001, 20002, 20200, 20201, 20202) lack separators
- **Type**: `lint/nursery/useNumericSeparators`
- **Fixable**: Yes (safe fix: add underscores like `20_000`)
- **Recommendation**: Improve readability with numeric separators

### 3. Configuration File Formatting
**File**: `biome.json`

- **Problem**: Large configuration file needs formatting
- **Lines**: 1-148 (entire file)
- **Type**: Formatting issue
- **Fixable**: Yes (auto-format available)

## Recommendations

1. **Auto-fix safe issues**: Run `bun run lint:clean --write` to auto-fix:
   - Numeric separator additions
   - Exhaustive dependency removals
   - Configuration file formatting

2. **Review before committing**: While fixes are marked as "safe", review changes to ensure:
   - Hook dependencies are correctly identified
   - Numeric separators don't break any logic
   - Configuration changes are expected

3. **Increase diagnostic limit**: To see all 93 hidden diagnostics, run:
   ```bash
   bun x @biomejs/biome check --skip-parse-errors . --max-diagnostics=200
   ```

## Fixes Applied

### ✅ Fixed: Numeric Separators in grayscale-converter.ts (2025-10-03)

**File**: `apps\web\grayscale-converter.ts` (Lines 98-99)

**Changes Made**:
```typescript
// BEFORE
const greenPixel: [number, number, number] = [originalData[20000], originalData[20001], originalData[20002]];
const yellowPixel: [number, number, number] = [originalData[20200], originalData[20201], originalData[20202]];

// AFTER
const greenPixel: [number, number, number] = [originalData[20_000], originalData[20_001], originalData[20_002]];
const yellowPixel: [number, number, number] = [originalData[20_200], originalData[20_201], originalData[20_202]];
```

**Impact**:
- ✅ Improved readability with numeric separators
- ✅ No functionality changes (separators are syntax sugar)
- ✅ Build passed successfully
- ✅ 6 lint errors resolved

**Verification**:
```bash
$ bun run build
✓ built in 25.70s
Tasks: 1 successful, 1 total
```

## Remaining Issues

### 1. Exhaustive Dependencies (2 issues) - NOT FIXED
**File**: `apps\web\src\components\editor\draw\canvas\drawing-canvas.tsx`
**Status**: Requires manual review before fixing
**Reason**: Removing dependencies from React hooks can affect reactivity

### 2. Configuration File Formatting - NOT FIXED
**File**: `biome.json`
**Status**: Low priority (formatting only)

## Next Steps

1. ~~Apply numeric separator fixes~~ ✅ COMPLETED
2. Review exhaustive dependencies issues (requires careful testing)
3. Review remaining errors/warnings (66 errors, 36 warnings remaining)
4. Consider formatting biome.json if needed

## Full Output

```
$ bun x @biomejs/biome check --skip-parse-errors .

[Errors truncated - see above summary]

Checked 658 files in 35s. No fixes applied.
Found 72 errors.
Found 36 warnings.
```
