# Phase 3: Split `export-engine-cli.ts` (1292 → ~780)

**Risk Level:** Low-Medium — class methods extracted to standalone modules, class delegates to them
**Estimated Time:** ~30 minutes

## Overview

`CLIExportEngine` is a class with clear logical sections. Two areas are independently extractable:
1. **Audio preparation pipeline** (lines 362-564, ~200 lines) — multi-step audio extraction/validation
2. **Electron API bridge + utilities** (lines 252-360, ~110 lines) — safe Electron access pattern + file ops

The core `export()` and `exportWithCLI()` methods stay in the class — they orchestrate the pipeline and are tightly coupled to instance state.

## Source File

`apps/web/src/lib/export-engine-cli.ts` — 1292 lines

### Current Structure

| Section | Lines | Description |
|---------|------:|-------------|
| Imports & types | 1-66 | External modules, extracted module imports, type aliases |
| Class definition & constructor | 62-95 | Instance vars, validation |
| **Filter/source wrapper methods** | **105-235** | **Bridge to extracted modules** |
| **Electron API bridge** | **252-360** | **Safe invoke, file ops, ffprobe** |
| **Audio preparation pipeline** | **362-564** | **Resolve inputs, prepare audio files** |
| Export orchestration (`export()`) | 603-758 | Session lifecycle, mode detection |
| FFmpeg execution (`exportWithCLI()`) | 774-1220 | Filter chains, options, invocation |
| Output & cleanup | 1222-1291 | Read file, validate duration, cleanup |

Bold = extraction targets.

---

## New Files

### 1. `apps/web/src/lib/export-engine-cli-audio.ts` (~220 lines)

**Contents:** Audio file extraction, validation, and preparation pipeline.

| Function | Current Lines | Description |
|----------|--------------|-------------|
| `resolveAudioPreparationInputs()` | 362-456 | Hydrate missing audio media items from storage |
| `prepareAudioFilesForExport()` | 458-564 | Extract and validate audio files for FFmpeg |

These become standalone async functions:

```typescript
interface AudioPrepDeps {
  tracks: TimelineTrack[]
  mediaItems: MediaItem[]
  audioOptions: AudioExportOptions
  sessionId: string | null
  fileExists: (path: string) => Promise<boolean>
  validateAudioWithFfprobe: (path: string) => Promise<AudioValidationLike | null>
  getFileInfo: (path: string) => Promise<FileInfoLike | null>
  getOptionalInvoke: () => ElectronInvoke | null
}

export async function resolveAudioPreparationInputs(
  tracks: TimelineTrack[],
  mediaItems: MediaItem[]
): Promise<{ tracks: TimelineTrack[]; mediaItems: MediaItem[] }>

export async function prepareAudioFilesForExport(
  deps: AudioPrepDeps
): Promise<AudioFileInput[]>
```

**Dependencies:**
- `extractAudioFileInputs`, `detectAudioSources` from `./export-cli/sources/audio-sources`
- `debugLog`, `debugWarn` from `@/lib/debug-config`
- `useProjectStore` (for media item hydration in resolve step)

### 2. `apps/web/src/lib/export-engine-cli-utils.ts` (~200 lines)

**Contents:** Electron API bridge and wrapper methods.

| Function | Current Lines | Description |
|----------|--------------|-------------|
| `getOptionalElectronInvoke()` | 252-270 | Safe Electron invoke accessor |
| `invokeIfAvailable()` | 272-292 | Invoke with fallback |
| `getFileInfo()` | 294-311 | File metadata via Electron |
| `fileExists()` | 313-336 | File existence check |
| `validateAudioWithFfprobe()` | 338-360 | Audio format validation |
| Filter/source wrappers | 105-235 | Bridge methods (as standalone functions) |

```typescript
export function getOptionalElectronInvoke(): ElectronInvoke | null
export async function invokeIfAvailable(channel: string, ...args: unknown[]): Promise<unknown>
export async function getFileInfo(filePath: string): Promise<FileInfoLike | null>
export async function fileExists(filePath: string): Promise<boolean>
export async function validateAudioWithFfprobe(filePath: string): Promise<AudioValidationLike | null>

// Wrapper functions that take instance deps as params
export function countVisibleVideoElements(tracks: TimelineTrack[]): number
export function extractVideoSourcesForExport(
  tracks: TimelineTrack[], mediaItems: MediaItem[], sessionId: string | null
): VideoSourceInput[]
// ... etc
```

---

## What Stays in `export-engine-cli.ts` (~780 lines)

| Section | Lines | Description |
|---------|------:|-------------|
| Imports | ~40 | + imports from new modules |
| Type aliases | ~15 | FileInfoLike, AudioValidationLike, ElectronInvoke |
| Class definition & constructor | ~35 | Instance vars, validation |
| `export()` method | ~155 | Session lifecycle, mode detection, orchestration |
| `exportWithCLI()` method | ~450 | Filter chains, options building, FFmpeg invocation |
| Output & cleanup | ~70 | Read file, validate duration, cleanup |
| Delegating methods | ~15 | Thin wrappers calling imported functions |

The class constructor stores instance state. Methods like `export()` and `exportWithCLI()` call the extracted functions with appropriate parameters:

```typescript
// In export() method
const audioFiles = await prepareAudioFilesForExport({
  tracks: this.tracks,
  mediaItems: this.mediaItems,
  audioOptions: this.audioOptions,
  sessionId: this.sessionId,
  fileExists: (p) => fileExists(p),
  validateAudioWithFfprobe: (p) => validateAudioWithFfprobe(p),
  getFileInfo: (p) => getFileInfo(p),
  getOptionalInvoke: () => getOptionalElectronInvoke(),
})
```

---

## Implementation Steps

### Step 1: Create `export-engine-cli-utils.ts`

1. Create the file
2. Move Electron bridge functions (lines 252-360):
   - `getOptionalElectronInvoke()`, `invokeIfAvailable()`, `getFileInfo()`, `fileExists()`, `validateAudioWithFfprobe()`
3. Move wrapper functions (lines 105-235):
   - Convert from class methods to standalone functions
   - Add explicit parameters for `this.tracks`, `this.mediaItems`, `this.sessionId`, etc.
4. Move `countVisibleVideoElements()` (lines 162-186)
5. Add necessary imports
6. Export type aliases: `ElectronInvoke`, `FileInfoLike`, `AudioValidationLike`

### Step 2: Create `export-engine-cli-audio.ts`

1. Create the file
2. Move `resolveAudioPreparationInputs()` (lines 362-456)
   - Uses `useProjectStore.getState()` — import store directly
3. Move `prepareAudioFiles()` → rename to `prepareAudioFilesForExport()` (lines 458-564)
   - Convert from class method to standalone function
   - Accept deps interface for file operations and Electron access
4. Add imports for extracted audio modules, debug utils

### Step 3: Update `export-engine-cli.ts`

1. Remove moved code
2. Add imports from new modules
3. Update `export()` to call `prepareAudioFilesForExport()` with deps
4. Update `exportWithCLI()` to call wrapper functions from utils module
5. Keep type aliases exported (other files may import them)

### Step 4: Verify imports

1. Check all importers of `export-engine-cli.ts`:
   - Should only import `CLIExportEngine` class
   - Type aliases re-exported if needed

---

## Risks

| Risk | Mitigation |
|------|------------|
| Class methods use `this` properties | Convert to explicit parameters in standalone functions |
| `resolveAudioPreparationInputs` accesses store | Import `useProjectStore` directly (same pattern as current) |
| `prepareAudioFiles` creates temp files via Electron | Pass Electron invoke as callback in deps |
| Circular imports | One-directional: utils module has no dependency on class |
| `exportWithCLI` is 450 lines | Stays in class — further split could happen in v5 |

## Verification

```bash
bun check-types
bun lint:clean
bun run test
bun run electron:dev  # Export a project with:
```

## Test Scenarios

- [ ] Export video with audio tracks (Mode 1 — direct copy)
- [ ] Export video with text overlays (Mode 2 — direct video + filters)
- [ ] Export with sticker overlays
- [ ] Export with image overlays
- [ ] Audio validation rejects invalid audio files
- [ ] Export without audio (audio disabled in settings)
- [ ] Cleanup runs after export completes
- [ ] Error messages display correctly for FFmpeg failures
