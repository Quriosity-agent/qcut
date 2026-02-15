# Phase 1: Split `ai-pipeline-handler.ts` (1420 → ~750)

**Risk Level:** Low — clear extraction boundaries, Electron-side only, no UI impact
**Estimated Time:** ~30 minutes
**Status:** Implemented (validated 2026-02-15)

## Implementation Result (Current Code)

- `electron/ai-pipeline-handler.ts` now focuses on `AIPipelineManager` orchestration and is **925 lines**
- Output parsing/recovery helpers are extracted to `electron/ai-pipeline-output.ts` (**325 lines**)
- IPC setup/cleanup is extracted to `electron/ai-pipeline-ipc.ts` (**184 lines**)
- `electron/main.ts` and Electron tests consume `setupAIPipelineIPC`/`cleanupAIPipeline` from `ai-pipeline-ipc`

## Overview

The `AIPipelineManager` class at 1150 lines contains output path parsing (~260 lines) and IPC registration (~170 lines) that are independently extractable. The core class orchestrates child process execution — extracting the I/O and IPC wiring reduces it to its essential orchestration role.

## Source File

`electron/ai-pipeline-handler.ts` — 1420 lines

### Current Structure

| Section | Lines | Description |
|---------|------:|-------------|
| Imports & types | 1-83 | Type definitions, constants |
| Class constructor & init | 89-131 | Setup, lazy initialization |
| Environment detection | 137-262 | Binary detection, version checks |
| Public status methods | 264-364 | Availability, status, error messages |
| Config & command building | 366-472 | Timeout, command args, session IDs |
| Output directory handling | 474-502 | Temp dir creation |
| **Output path extraction** | **504-762** | **File collection, path parsing, dedup** |
| **Spawn env & error classification** | **764-837** | **API key injection, error codes** |
| Auto-import logic | 839-891 | Conditional media import |
| Main execute() | 896-1205 | Core orchestration (~310 lines) |
| Process management | 1211-1238 | Cancel, cancelAll, getActiveCount |
| **IPC handler registration** | **1241-1420** | **6 IPC handlers + cleanup** |

Bold = extraction targets.

---

## New Files

### 1. `electron/ai-pipeline-output.ts` (~250 lines)

**Contents:** All output path extraction and file collection utilities.

| Function | Current Lines | Description |
|----------|--------------|-------------|
| `OUTPUT_FILE_EXTENSIONS_PATTERN` | 78-79 | Regex constant |
| `OUTPUT_FILE_REGEX` | 80-83 | Compiled regex |
| `collectOutputFiles()` | 504-548 | Recursive file collection with mtimes |
| `captureOutputSnapshot()` | 550-564 | Pre-execution file snapshot |
| `normalizeOutputPath()` | 566-600 | Validate & normalize single path |
| `dedupePaths()` | 602-616 | Remove duplicate paths |
| `extractOutputPathsFromText()` | 618-664 | Regex-based stdout/stderr parsing |
| `extractOutputPathsFromJson()` | 666-725 | Recursive JSON traversal for paths |
| `recoverOutputPathsFromDirectory()` | 727-762 | Find new/modified files by mtime |
| `classifyErrorCode()` | 783-819 | Categorize error messages |
| `inferProjectIdFromPath()` | 821-837 | Extract project ID from file path |

**Exports:**
```typescript
export {
  OUTPUT_FILE_EXTENSIONS_PATTERN,
  OUTPUT_FILE_REGEX,
  collectOutputFiles,
  captureOutputSnapshot,
  normalizeOutputPath,
  dedupePaths,
  extractOutputPathsFromText,
  extractOutputPathsFromJson,
  recoverOutputPathsFromDirectory,
  classifyErrorCode,
  inferProjectIdFromPath,
}
```

**Dependencies:**
- `fs`, `path` (Node built-ins)
- No class instance state — all functions take explicit parameters

### 2. `electron/ai-pipeline-ipc.ts` (~170 lines)

**Contents:** IPC handler registration and cleanup.

| Function | Current Lines | Description |
|----------|--------------|-------------|
| `setupAIPipelineIPC()` | 1258-1405 | Registers 7 IPC handlers |
| `cleanupAIPipeline()` | 1413-1416 | Kills all processes |
| App quit listener | 1418-1420 | Auto-cleanup on exit |

**Exports:**
```typescript
export { setupAIPipelineIPC, cleanupAIPipeline }
```

**Dependencies:**
- `electron`: `ipcMain`, `BrowserWindow`, `app`
- `AIPipelineManager` class imported from main file

---

## What Stays in `ai-pipeline-handler.ts` (~750 lines)

| Section | Lines | Description |
|---------|------:|-------------|
| Imports & types | ~60 | Reduced imports (output funcs from new module) |
| PipelineConfig, GenerateOptions, etc. | ~55 | Type definitions stay |
| AIPipelineManager class | ~600 | Constructor, init, detection, status, config, execute, cancel |
| buildSpawnEnvironment() | ~18 | API key injection (used only by execute) |
| maybeAutoImportOutput() | ~53 | Auto-import logic (tightly coupled to execute) |
| Re-exports | ~5 | Re-export from ai-pipeline-output, ai-pipeline-ipc |

---

## Implementation Steps

### Step 1: Create `ai-pipeline-output.ts`

1. Create `electron/ai-pipeline-output.ts`
2. Move constants: `OUTPUT_FILE_EXTENSIONS_PATTERN`, `OUTPUT_FILE_REGEX` (lines 78-83)
3. Move functions: `collectOutputFiles`, `captureOutputSnapshot`, `normalizeOutputPath`, `dedupePaths`, `extractOutputPathsFromText`, `extractOutputPathsFromJson`, `recoverOutputPathsFromDirectory` (lines 504-762)
4. Move `classifyErrorCode` (lines 783-819) and `inferProjectIdFromPath` (lines 821-837)
5. Add `fs` and `path` imports
6. Convert class methods to standalone functions — add explicit parameters where `this` was used:
   - `collectOutputFiles(dirPath: string)` — already takes dirPath
   - `captureOutputSnapshot(outputDir: string)` — already takes outputDir
   - `normalizeOutputPath(rawPath: string, outputDir: string | null)` — add outputDir param
   - `extractOutputPathsFromText(text: string)` — already standalone
   - `extractOutputPathsFromJson(jsonData: unknown)` — already standalone
   - `recoverOutputPathsFromDirectory(outputDir: string, snapshot: Map<string, number>)` — already takes params

### Step 2: Create `ai-pipeline-ipc.ts`

1. Create `electron/ai-pipeline-ipc.ts`
2. Move `setupAIPipelineIPC()` (lines 1258-1405)
3. Move `cleanupAIPipeline()` (lines 1413-1416)
4. Move app quit listener (lines 1418-1420)
5. Move module-level state: `pipelineManager` singleton, `getMainWindow()` helper (lines 1245-1253)
6. Import `AIPipelineManager` from `./ai-pipeline-handler.js`
7. Export `setupAIPipelineIPC`, `cleanupAIPipeline`

### Step 3: Update `ai-pipeline-handler.ts`

1. Remove moved code sections
2. Add imports from `./ai-pipeline-output.js`
3. Update `execute()` to call imported functions instead of `this.` methods
4. Add re-exports: `export { setupAIPipelineIPC, cleanupAIPipeline } from './ai-pipeline-ipc.js'`
5. Verify class still exports correctly

### Step 4: Update external imports

1. Check all files that import from `ai-pipeline-handler`:
   - `electron/main.ts` — likely imports `setupAIPipelineIPC`
   - Any other electron handlers
2. Update import paths if needed (re-exports should make this transparent)

---

## Risks

| Risk | Mitigation |
|------|------------|
| Class methods use `this` | Convert to standalone functions with explicit params |
| `execute()` calls output methods | Import from `ai-pipeline-output.ts`, call as functions |
| IPC handlers reference singleton | Move singleton to IPC module, import class from main |
| Circular imports | One-directional: IPC imports class, class does not import IPC |
| `buildSpawnEnvironment` uses `api-key-handler` | Keep in main file — only 18 lines, tightly coupled to execute |

## Verification

```bash
bun check-types
bun lint:clean
bun run test
bun run electron:dev  # Test AI pipeline generate, cancel, status check
```

## Test Scenarios

- [ ] AI pipeline status check returns version and features
- [ ] Image generation completes and output file is found
- [ ] Cancel stops running generation
- [ ] Auto-import adds generated file to project media
- [ ] Error messages display correctly for missing API key
