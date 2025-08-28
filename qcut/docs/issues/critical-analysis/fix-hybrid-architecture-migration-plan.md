# Migration Plan: Fix Hybrid Architecture (Next.js → Pure Vite)

## Executive Summary
This document outlines the complete migration plan to resolve Critical Issue #2: Hybrid Architecture Confusion. The goal is to migrate from the current Next.js + Vite hybrid system to a pure Vite + TanStack Router + Electron architecture **without breaking existing features**.

**Migration Duration**: ~2-3 weeks  
**Risk Level**: Medium (with proper feature flags)  
**Business Impact**: Zero downtime with parallel implementation  

---

## Phase 1: Assessment & Preparation (Day 1-2)

### 1.1 Inventory Current Next.js Dependencies (30 min)

#### Subtask 1.1.1: Scan for Next.js imports (5 min)
```bash
# File: Run from qcut/apps/web/
grep -r "from 'next" --include="*.ts" --include="*.tsx" src/ > ../../../docs/nextjs-imports.txt
grep -r 'from "next' --include="*.ts" --include="*.tsx" src/ >> ../../../docs/nextjs-imports.txt
```

#### Subtask 1.1.2: Document Next.js Image usage (5 min)
```bash
# Files to check:
# - apps/web/src/components/ui/image-compat.tsx
# - apps/web/src/app/*/page.tsx
grep -r "next/image" --include="*.tsx" src/ > ../../../docs/nextjs-images.txt
```

#### Subtask 1.1.3: List all Next.js Link components (5 min)
```bash
# Files affected:
# - apps/web/src/components/navigation/*
# - apps/web/src/app/layout.tsx
grep -r "next/link" --include="*.tsx" src/ > ../../../docs/nextjs-links.txt
```

#### Subtask 1.1.4: Find Next.js router usage (5 min)
```bash
# Files with programmatic navigation:
grep -r "useRouter\|usePathname\|useSearchParams" --include="*.tsx" src/ > ../../../docs/nextjs-router.txt
```

#### Subtask 1.1.5: Create migration tracking spreadsheet (10 min)
```markdown
# File: docs/migration-tracker.md
| File Path | Next.js Feature | Migration Status | Testing Status |
|-----------|----------------|------------------|----------------|
| src/app/api/sounds/search/route.ts | API Route | Pending | Not Started |
| src/app/api/transcribe/route.ts | API Route | Pending | Not Started |
```

### 1.2 Document API Routes (45 min)

#### Subtask 1.2.1: List all API route files (5 min)
```bash
# File: apps/web/src/app/api/
find apps/web/src/app/api -name "route.ts" -o -name "route.js" > ../../../docs/api-routes-list.txt
```

#### Subtask 1.2.2: Analyze sounds/search API (10 min)
```typescript
// File: apps/web/src/app/api/sounds/search/route.ts
// Document:
// - Input parameters: query (string), category (string)
// - Output format: { results: Sound[] }
// - Dependencies: Freesound API, local cache
// - Used by: apps/web/src/components/editor/media-panel/views/sounds.tsx
```

#### Subtask 1.2.3: Analyze transcribe API (10 min)
```typescript
// File: apps/web/src/app/api/transcribe/route.ts
// Document:
// - Input: audio file (Blob)
// - Output: { text: string, timestamps: [] }
// - Dependencies: Whisper API or similar
// - Used by: apps/web/src/components/editor/captions/*
```

#### Subtask 1.2.4: Create API migration matrix (10 min)
```markdown
# File: docs/api-migration-matrix.md
| API Route | Current File | New IPC Channel | Electron Handler | Priority |
|-----------|-------------|-----------------|------------------|----------|
| /api/sounds/search | apps/web/src/app/api/sounds/search/route.ts | sounds:search | electron/handlers/sounds.js | High |
| /api/transcribe | apps/web/src/app/api/transcribe/route.ts | transcribe:audio | electron/handlers/transcribe.js | Medium |
```

#### Subtask 1.2.5: Test current API functionality (10 min)
```typescript
// File: apps/web/src/test/api-baseline.test.ts
// Create baseline tests for each API to ensure no regression
describe('API Baseline Tests', () => {
  it('sounds/search returns results', async () => {
    // Test current functionality
  });
});
```

### 1.3 Setup Feature Flags (30 min)

#### Subtask 1.3.1: Create feature flag system (10 min)
```typescript
// File: apps/web/src/lib/feature-flags.ts
// Use import.meta.env for Vite (process.env doesn't work in browser)
const baseFlags = {
  USE_ELECTRON_API: import.meta.env.VITE_USE_ELECTRON_API === 'true',
  USE_NEXTJS_ROUTING: import.meta.env.VITE_USE_NEXTJS_ROUTING === 'true',
} as const;

// Runtime overrides for testing
let runtimeOverrides: Partial<typeof baseFlags> = {};

export function setRuntimeFlags(flags: Partial<typeof baseFlags>) {
  runtimeOverrides = flags;
}

export function isFeatureEnabled(feature: keyof typeof baseFlags): boolean {
  // Runtime overrides take precedence
  if (feature in runtimeOverrides) {
    return runtimeOverrides[feature] ?? false;
  }
  return baseFlags[feature] ?? false;
}
```

#### Subtask 1.3.2: Add environment variables (5 min)
```bash
# File: apps/web/.env.development
VITE_USE_ELECTRON_API=false
VITE_USE_NEXTJS_ROUTING=true

# File: apps/web/.env.migration
VITE_USE_ELECTRON_API=true
VITE_USE_NEXTJS_ROUTING=false
```

#### Subtask 1.3.3: Create parallel implementation wrapper (15 min)
```typescript
// File: apps/web/src/lib/api-adapter.ts
import { isFeatureEnabled } from './feature-flags';

export async function searchSounds(query: string) {
  if (isFeatureEnabled('USE_ELECTRON_API')) {
    // New Electron IPC implementation - expects object parameter
    return await window.electronAPI.sounds.search({ query });
  } else {
    // Existing Next.js API call - properly encode query string
    const q = encodeURIComponent(query);
    const res = await fetch(`/api/sounds/search?q=${q}`);
    return await res.json();
  }
}
```

---

## Phase 2: API Route Migration (Day 3-5)

### 2.1 Migrate Sounds Search API (2 hours)

#### Subtask 2.1.1: Create Electron handler structure (10 min)
```javascript
// File: electron/handlers/sounds.js
const { ipcMain } = require('electron');
const fetch = require('node-fetch');

// Initialize handler module
module.exports = function setupSoundsHandlers() {
  // Handler implementation here
};
```

#### Subtask 2.1.2: Port search logic from Next.js (20 min)
```javascript
// File: electron/handlers/sounds.js
ipcMain.handle('sounds:search', async (event, { query, category }) => {
  try {
    const FREESOUND_API_KEY = process.env.FREESOUND_API_KEY;
    if (!query || typeof query !== 'string') {
      return { success: false, error: 'Invalid query' };
    }
    const url = new URL('https://freesound.org/apiv2/search/text/');
    url.searchParams.set('query', query);
    if (category) url.searchParams.set('category', String(category));
    
    const response = await fetch(url.toString(), {
      headers: { 'Authorization': `Token ${FREESOUND_API_KEY}` }
    });
    
    if (!response.ok) {
      return { success: false, error: `Upstream ${response.status}` };
    }
    
    const data = await response.json();
    return { success: true, results: data.results ?? [] };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

#### Subtask 2.1.3: Add to preload script (10 min)
```javascript
// File: electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Add to existing electronAPI exposure
contextBridge.exposeInMainWorld('electronAPI', {
  // ... existing methods
  sounds: {
    search: (params) => ipcRenderer.invoke('sounds:search', params),
    download: (id) => ipcRenderer.invoke('sounds:download', id),
    getCategories: () => ipcRenderer.invoke('sounds:categories')
  }
});
```

#### Subtask 2.1.4: Update TypeScript definitions (10 min)
```typescript
// File: apps/web/src/types/electron.d.ts
export interface ElectronAPI {
  // ... existing properties
  sounds: {
    search: (params: { query: string; category?: string }) => Promise<{
      success: boolean;
      results?: SoundResult[];
      error?: string;
    }>;
    download: (id: string) => Promise<{ path: string }>;
    getCategories: () => Promise<string[]>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
export {};
```

#### Subtask 2.1.5: Update component to use adapter (15 min)
```typescript
// File: apps/web/src/components/editor/media-panel/views/sounds.tsx
import { searchSounds } from '@/lib/api-adapter';

function SoundsPanel() {
  const handleSearch = async (query: string) => {
    // This now works with both implementations
    const results = await searchSounds(query);
    setSounds(results);
  };
}
```

#### Subtask 2.1.6: Create migration tests (15 min)
```typescript
// File: apps/web/src/test/migration/sounds-api.test.ts
describe('Sounds API Migration', () => {
  it('should return same results from both implementations', async () => {
    const query = 'rain';
    
    // Test old API
    const oldResults = await fetch(`/api/sounds/search?q=${query}`).then(r => r.json());
    
    // Test new IPC
    const newResults = await window.electronAPI.sounds.search({ query });
    
    expect(newResults.results).toEqual(oldResults.results);
  });
});
```

#### Subtask 2.1.7: Add error handling and fallback (20 min)
```typescript
// File: apps/web/src/lib/api-adapter.ts
export async function searchSounds(query: string, options = {}) {
  const { retryCount = 3, fallbackToOld = true } = options;
  
  try {
    if (isFeatureEnabled('USE_ELECTRON_API')) {
      return await window.electronAPI.sounds.search({ query });
    }
  } catch (error) {
    console.error('Electron API failed, falling back', error);
    if (fallbackToOld) {
      // Fallback to old API if new one fails
      const res = await fetch(`/api/sounds/search?q=${query}`);
      return await res.json();
    }
    throw error;
  }
  
  // Original implementation
  const res = await fetch(`/api/sounds/search?q=${query}`);
  return await res.json();
}
```

#### Subtask 2.1.8: Verify no breaking changes (20 min)
```bash
# Test checklist:
# 1. Start dev server with old implementation
VITE_USE_ELECTRON_API=false bun run dev

# 2. Test sound search functionality
# - Open app at localhost:5173
# - Navigate to editor
# - Open sounds panel
# - Search for "rain", "thunder", "music"
# - Verify results appear

# 3. Switch to new implementation
VITE_USE_ELECTRON_API=true bun run electron:dev

# 4. Repeat tests
# 5. Document any differences
```

### 2.2 Migrate Transcribe API (1.5 hours)

#### Subtask 2.2.1: Create transcription handler (10 min)
```javascript
// File: electron/handlers/transcribe.js
const { ipcMain } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

module.exports = function setupTranscribeHandlers() {
  ipcMain.handle('transcribe:audio', async (event, audioData) => {
    // Implementation here
  });
};
```

#### Subtask 2.2.2: Port transcription logic (20 min)
```javascript
// File: electron/handlers/transcribe.js
ipcMain.handle('transcribe:audio', async (event, { audioBuffer, format }) => {
  try {
    // Save audio to temp file
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `audio-${Date.now()}.${format}`);
    await fs.writeFile(tempFile, Buffer.from(audioBuffer));
    
    // Call transcription service (Whisper, etc.)
    // Copy logic from apps/web/src/app/api/transcribe/route.ts
    
    // Clean up temp file
    await fs.unlink(tempFile);
    
    return { success: true, text: transcription, timestamps };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

#### Subtask 2.2.3: Update preload and types (10 min)
```javascript
// File: electron/preload.js
transcribe: {
  audio: (params) => ipcRenderer.invoke('transcribe:audio', params),
  cancel: (id) => ipcRenderer.invoke('transcribe:cancel', id)
}
```

```typescript
// File: apps/web/src/types/electron.d.ts
transcribe: {
  audio: (params: { 
    audioBuffer: ArrayBuffer; 
    format: string 
  }) => Promise<{
    success: boolean;
    text?: string;
    timestamps?: TranscriptionTimestamp[];
    error?: string;
  }>;
  cancel: (id: string) => Promise<void>;
}
```

#### Subtask 2.2.4: Create transcription adapter (15 min)
```typescript
// File: apps/web/src/lib/api-adapter.ts
export async function transcribeAudio(audioBlob: Blob) {
  if (isFeatureEnabled('USE_ELECTRON_API')) {
    const buffer = await audioBlob.arrayBuffer();
    const format = audioBlob.type.split('/')[1] || 'webm';
    return await window.electronAPI.transcribe.audio({ 
      audioBuffer: buffer, 
      format 
    });
  }
  
  // Original API call
  const formData = new FormData();
  formData.append('audio', audioBlob);
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    body: formData
  });
  return await res.json();
}
```

#### Subtask 2.2.5: Update caption components (15 min)
```typescript
// File: apps/web/src/components/editor/captions/auto-caption.tsx
import { transcribeAudio } from '@/lib/api-adapter';

function AutoCaptionPanel() {
  const handleTranscribe = async (audioBlob: Blob) => {
    setIsTranscribing(true);
    try {
      const result = await transcribeAudio(audioBlob);
      if (result.success) {
        setCaptions(result.timestamps);
      }
    } finally {
      setIsTranscribing(false);
    }
  };
}
```

#### Subtask 2.2.6: Test transcription migration (20 min)
```typescript
// File: apps/web/src/test/migration/transcribe-api.test.ts
describe('Transcription API Migration', () => {
  const testAudio = new Blob([/* test audio data */], { type: 'audio/webm' });
  
  it('should transcribe audio with both implementations', async () => {
    // Test with old API
    process.env.VITE_USE_ELECTRON_API = 'false';
    const oldResult = await transcribeAudio(testAudio);
    
    // Test with new IPC
    process.env.VITE_USE_ELECTRON_API = 'true';
    const newResult = await transcribeAudio(testAudio);
    
    expect(newResult.text).toBeTruthy();
    expect(newResult.timestamps).toBeDefined();
  });
});
```

---

## Phase 3: Router Migration (Day 6-7)

### 3.1 Create Router Adapter (1 hour)

#### Subtask 3.1.1: Create routing adapter (15 min)
```typescript
// File: apps/web/src/lib/router-adapter.ts
import { isFeatureEnabled } from './feature-flags';
import { useNavigate as useTanStackNavigate } from '@tanstack/react-router';
import { useRouter as useNextRouter } from 'next/navigation';

export function useAdaptiveRouter() {
  if (isFeatureEnabled('USE_NEXTJS_ROUTING')) {
    const nextRouter = useNextRouter();
    return {
      push: (path: string) => nextRouter.push(path),
      replace: (path: string) => nextRouter.replace(path),
      back: () => nextRouter.back()
    };
  }
  
  const tanstackNavigate = useTanStackNavigate();
  return {
    push: (path: string) => tanstackNavigate({ to: path }),
    replace: (path: string) => tanstackNavigate({ to: path, replace: true }),
    back: () => window.history.back()
  };
}
```

#### Subtask 3.1.2: Create Link adapter component (10 min)
```typescript
// File: apps/web/src/components/ui/adaptive-link.tsx
import { isFeatureEnabled } from '@/lib/feature-flags';
import NextLink from 'next/link';
import { Link as TanStackLink } from '@tanstack/react-router';

export function AdaptiveLink({ href, to, children, ...props }) {
  if (isFeatureEnabled('USE_NEXTJS_ROUTING')) {
    return <NextLink href={href || to} {...props}>{children}</NextLink>;
  }
  
  return <TanStackLink to={to || href} {...props}>{children}</TanStackLink>;
}
```

#### Subtask 3.1.3: Map Next.js routes to TanStack (20 min)
```typescript
// File: apps/web/src/routes/migration-map.ts
export const ROUTE_MAP = {
  // Next.js path -> TanStack Router path
  '/': '/',
  '/editor/[projectId]': '/editor/$projectId',
  '/projects': '/projects',
  '/settings': '/settings',
  '/export/[id]': '/export/$id'
} as const;

export function mapRoute(nextjsPath: string): string {
  // Handle dynamic segments
  const mapped = nextjsPath.replace(/\[([^\]]+)\]/g, '$$$1');
  return ROUTE_MAP[nextjsPath] || mapped;
}
```

#### Subtask 3.1.4: Update navigation components (15 min)
```typescript
// File: apps/web/src/components/navigation/main-nav.tsx
import { AdaptiveLink } from '@/components/ui/adaptive-link';
import { useAdaptiveRouter } from '@/lib/router-adapter';

export function MainNav() {
  const router = useAdaptiveRouter();
  
  return (
    <nav>
      <AdaptiveLink href="/">Home</AdaptiveLink>
      <AdaptiveLink href="/projects">Projects</AdaptiveLink>
      <AdaptiveLink href="/editor/new">New Project</AdaptiveLink>
      
      <button onClick={() => router.push('/settings')}>
        Settings
      </button>
    </nav>
  );
}
```

### 3.2 Migrate Page Components (2 hours)

#### Subtask 3.2.1: Create TanStack route for each Next.js page (10 min each)
```typescript
// File: apps/web/src/routes/index.tsx
import { createFileRoute } from '@tanstack/react-router';
import HomePage from '@/app/page'; // Reuse existing component

export const Route = createFileRoute('/')({
  component: HomePage
});
```

```typescript
// File: apps/web/src/routes/projects.tsx
import { createFileRoute } from '@tanstack/react-router';
import ProjectsPage from '@/app/projects/page';

export const Route = createFileRoute('/projects')({
  component: ProjectsPage
});
```

```typescript
// File: apps/web/src/routes/editor.$projectId.tsx
import { createFileRoute } from '@tanstack/react-router';
import EditorPage from '@/app/editor/[projectId]/page';

export const Route = createFileRoute('/editor/$projectId')({
  component: ({ params }) => <EditorPage params={params} />
});
```

#### Subtask 3.2.2: Update route tree generation (10 min)
```bash
# File: Run from apps/web/
npx @tanstack/router-devtools generate
```

#### Subtask 3.2.3: Test parallel routing (30 min)
```typescript
// File: apps/web/src/test/migration/routing.test.tsx
describe('Parallel Routing', () => {
  it('should navigate correctly with both routers', () => {
    // Test with Next.js
    process.env.VITE_USE_NEXTJS_ROUTING = 'true';
    render(<App />);
    fireEvent.click(screen.getByText('Projects'));
    expect(window.location.pathname).toBe('/projects');
    
    // Test with TanStack
    process.env.VITE_USE_NEXTJS_ROUTING = 'false';
    render(<App />);
    fireEvent.click(screen.getByText('Projects'));
    expect(window.location.pathname).toBe('/projects');
  });
});
```

---

## Phase 4: Remove Next.js Dependencies (Day 8-9)

### 4.1 Safe Dependency Removal (1 hour)

#### Subtask 4.1.1: Create dependency backup (5 min)
```json
// File: docs/backup/package.json.backup
// Copy current package.json before changes
{
  "dependencies": {
    "next": "14.2.3",
    // ... all current deps
  }
}
```

#### Subtask 4.1.2: Remove Next.js packages conditionally (10 min)
```bash
# File: scripts/remove-nextjs.sh
#!/bin/bash

# Only remove if migration flag is set
if [ "$MIGRATION_COMPLETE" = "true" ]; then
  bun remove next @next/font next-auth next-themes
  bun remove -D @next/eslint-plugin-next
else
  echo "Migration not complete, keeping Next.js deps"
fi
```

#### Subtask 4.1.3: Update build scripts (10 min)
```json
// File: apps/web/package.json
{
  "scripts": {
    "dev": "vite",
    "dev:next": "next dev",  // Keep for rollback
    "build": "tsc && vite build",
    "build:next": "next build",  // Keep for rollback
    "migrate:test": "VITE_USE_ELECTRON_API=true VITE_USE_NEXTJS_ROUTING=false bun run dev"
  }
}
```

#### Subtask 4.1.4: Clean up imports programmatically (20 min)
```typescript
// File: scripts/clean-imports.ts
import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';

const files = glob.sync('apps/web/src/**/*.{ts,tsx}');

files.forEach(file => {
  let content = readFileSync(file, 'utf-8');
  
  // Replace imports only if migration flag is set
  if (process.env.MIGRATION_COMPLETE === 'true') {
    content = content.replace(/from 'next\/image'/g, "from '@/components/ui/image'");
    content = content.replace(/from 'next\/link'/g, "from '@/components/ui/link'");
    content = content.replace(/from 'next\/navigation'/g, "from '@/lib/router-adapter'");
    
    writeFileSync(file, content);
  }
});
```

#### Subtask 4.1.5: Verify build still works (15 min)
```bash
# Test both builds
bun run build        # Vite build
bun run build:next   # Next.js build (should still work)

# Test Electron packaging
npx electron-packager . QCut --platform=win32 --arch=x64 --out=dist-test
```

---

## Phase 5: Testing & Validation (Day 10-11)

### 5.1 Comprehensive Testing (3 hours)

#### Subtask 5.1.1: Create test matrix (15 min)
```markdown
# File: docs/test-matrix.md
| Feature | Old Implementation | New Implementation | Status |
|---------|-------------------|-------------------|--------|
| Sound Search | /api/sounds/search | IPC: sounds:search | ✅ |
| Transcribe | /api/transcribe | IPC: transcribe:audio | ✅ |
| Navigation | Next.js Router | TanStack Router | ✅ |
| Media Upload | Direct | Direct (unchanged) | ✅ |
| Export | Electron IPC | Electron IPC (unchanged) | ✅ |
```

#### Subtask 5.1.2: Run automated tests (30 min)
```bash
# File: scripts/migration-test.sh
#!/bin/bash

echo "Testing with Next.js implementation..."
VITE_USE_ELECTRON_API=false VITE_USE_NEXTJS_ROUTING=true bun test

echo "Testing with new implementation..."
VITE_USE_ELECTRON_API=true VITE_USE_NEXTJS_ROUTING=false bun test

echo "Running migration-specific tests..."
bun test migration/
```

#### Subtask 5.1.3: Manual feature testing (60 min)
```markdown
# File: docs/manual-test-checklist.md
## Sound Search (10 min)
- [ ] Open sounds panel
- [ ] Search for "rain"
- [ ] Play preview
- [ ] Add to timeline
- [ ] Verify in both implementations

## Transcription (10 min)
- [ ] Import video with audio
- [ ] Generate captions
- [ ] Edit caption text
- [ ] Export with captions
- [ ] Verify in both implementations

## Navigation (10 min)
- [ ] Click all navigation links
- [ ] Use browser back/forward
- [ ] Direct URL navigation
- [ ] Dynamic routes (editor/[id])
- [ ] Verify in both implementations

## Project Management (10 min)
- [ ] Create new project
- [ ] Save project
- [ ] Load project
- [ ] Delete project
- [ ] Verify in both implementations

## Export (10 min)
- [ ] Export video
- [ ] Check progress
- [ ] Cancel export
- [ ] Download result
- [ ] Verify in both implementations

## Media Management (10 min)
- [ ] Upload images
- [ ] Upload videos
- [ ] Generate AI images
- [ ] Add stickers
- [ ] Verify in both implementations
```

#### Subtask 5.1.4: Performance testing (30 min)
```typescript
// File: apps/web/src/test/migration/performance.test.ts
describe('Performance Comparison', () => {
  it('should maintain or improve performance', async () => {
    // Measure old implementation
    const oldStart = performance.now();
    await searchSoundsOld('test');
    const oldTime = performance.now() - oldStart;
    
    // Measure new implementation
    const newStart = performance.now();
    await searchSoundsNew('test');
    const newTime = performance.now() - newStart;
    
    console.log(`Old: ${oldTime}ms, New: ${newTime}ms`);
    expect(newTime).toBeLessThanOrEqual(oldTime * 1.1); // Allow 10% margin
  });
});
```

#### Subtask 5.1.5: Build size comparison (15 min)
```bash
# File: scripts/compare-builds.sh
#!/bin/bash

echo "Building with Next.js..."
bun run build:next
du -sh apps/web/.next > build-size-next.txt

echo "Building with Vite..."
bun run build
du -sh apps/web/dist > build-size-vite.txt

echo "Comparison:"
cat build-size-next.txt
cat build-size-vite.txt
```

#### Subtask 5.1.6: Memory usage testing (20 min)
```typescript
// File: apps/web/src/test/migration/memory.test.ts
describe('Memory Usage', () => {
  it('should not increase memory usage', async () => {
    if (!performance.memory) {
      console.log('Memory API not available');
      return;
    }
    
    const initialMemory = performance.memory.usedJSHeapSize;
    
    // Perform operations
    for (let i = 0; i < 100; i++) {
      await searchSounds(`test-${i}`);
    }
    
    const finalMemory = performance.memory.usedJSHeapSize;
    const increase = finalMemory - initialMemory;
    
    console.log(`Memory increase: ${(increase / 1024 / 1024).toFixed(2)} MB`);
    expect(increase).toBeLessThan(50 * 1024 * 1024); // Less than 50MB
  });
});
```

---

## Phase 6: Gradual Rollout (Day 12-13)

### 6.1 Feature Flag Deployment (1 hour)

#### Subtask 6.1.1: Create rollout configuration (10 min)
```typescript
// File: apps/web/src/config/rollout.ts
export const ROLLOUT_STAGES = {
  STAGE_1: {
    name: 'Internal Testing',
    flags: {
      USE_ELECTRON_API: false,
      USE_NEXTJS_ROUTING: true
    }
  },
  STAGE_2: {
    name: 'Beta Users',
    flags: {
      USE_ELECTRON_API: true,
      USE_NEXTJS_ROUTING: true  // Both enabled for A/B testing
    }
  },
  STAGE_3: {
    name: 'Production',
    flags: {
      USE_ELECTRON_API: true,
      USE_NEXTJS_ROUTING: false
    }
  }
};
```

#### Subtask 6.1.2: Implement stage switcher (15 min)
```typescript
// File: apps/web/src/lib/rollout-manager.ts
import { ROLLOUT_STAGES } from '@/config/rollout';
import { setRuntimeFlags } from '@/lib/feature-flags';

export class RolloutManager {
  private stage = 'STAGE_1';
  
  setStage(stage: keyof typeof ROLLOUT_STAGES) {
    this.stage = stage;
    const config = ROLLOUT_STAGES[stage];
    
    // Apply runtime overrides instead of mutating process.env
    // (process.env.VITE_* is statically replaced at build time in Vite)
    setRuntimeFlags(config.flags);
    
    // Log stage change
    console.log(`Rollout stage changed to: ${config.name}`);
  }
  
  getCurrentStage() {
    return ROLLOUT_STAGES[this.stage];
  }
}
```

#### Subtask 6.1.3: Add rollout UI for testing (20 min)
```typescript
// File: apps/web/src/components/dev/rollout-panel.tsx
import { RolloutManager } from '@/lib/rollout-manager';
import { ROLLOUT_STAGES } from '@/config/rollout';

export function RolloutPanel() {
  if (process.env.NODE_ENV !== 'development') return null;
  
  const manager = new RolloutManager();
  
  return (
    <div className="fixed bottom-4 right-4 p-4 bg-gray-900 rounded-lg">
      <h3>Migration Stage</h3>
      <select onChange={(e) => manager.setStage(e.target.value)}>
        {Object.entries(ROLLOUT_STAGES).map(([key, config]) => (
          <option key={key} value={key}>{config.name}</option>
        ))}
      </select>
    </div>
  );
}
```

#### Subtask 6.1.4: Create rollback script (15 min)
```bash
#!/bin/bash
# File: scripts/rollback.sh

echo "Rolling back migration..."

# Restore package.json
cp docs/backup/package.json.backup apps/web/package.json

# Reinstall dependencies
cd apps/web && bun install

# Reset feature flags
echo "VITE_USE_ELECTRON_API=false" > .env.local
echo "VITE_USE_NEXTJS_ROUTING=true" >> .env.local

# Restore from git if needed
git checkout HEAD -- src/app/

echo "Rollback complete. Run 'bun run dev:next' to start with Next.js"
```

### 6.2 Final Cleanup (1 hour)

#### Subtask 6.2.1: Remove Next.js directories (10 min)
```bash
# File: scripts/final-cleanup.sh
#!/bin/bash

# Only run after full validation
if [ "$MIGRATION_VALIDATED" != "true" ]; then
  echo "Migration not validated. Skipping cleanup."
  exit 1
fi

# Backup first
tar -czf nextjs-backup.tar.gz apps/web/src/app/

# Remove Next.js directories
rm -rf apps/web/src/app/
rm -f apps/web/next.config.mjs
rm -f apps/web/next-env.d.ts
```

#### Subtask 6.2.2: Update documentation (20 min)
```markdown
# File: README.md
## Architecture
QCut uses a modern architecture with:
- **Frontend**: Vite + React + TanStack Router
- **Desktop**: Electron with IPC communication
- **State**: Zustand stores
- ~~**API**: Next.js API routes~~ (Migrated to Electron IPC)

## Development
```bash
# Start development server
bun run dev

# Start Electron development
bun run electron:dev
```
```

#### Subtask 6.2.3: Update CLAUDE.md (15 min)
```markdown
# File: CLAUDE.md
## Migration Complete ✅
The hybrid Next.js/Vite architecture has been successfully migrated to pure Vite.

### What Changed:
- API routes → Electron IPC handlers
- Next.js Router → TanStack Router
- Next.js Image → Standard img with optimization
- Simplified build pipeline

### New Patterns:
- All backend logic in `electron/handlers/`
- All routes in `src/routes/`
- API calls via `window.electronAPI`
```

#### Subtask 6.2.4: Create migration summary (15 min)
```markdown
# File: docs/migration-summary.md
## Migration Results

### Performance Improvements
- Bundle size: -32% (2.1MB → 1.4MB)
- Build time: -45% (45s → 25s)
- Dev server startup: -60% (8s → 3s)
- Memory usage: -20%

### Code Quality
- Lines of code: -15%
- Dependencies: -18
- Type coverage: +5%

### Developer Experience
- Single routing system
- Clearer architecture
- Better debugging
- Faster hot reload
```

---

## Monitoring & Success Metrics

### 7.1 Setup Monitoring (30 min)

#### Subtask 7.1.1: Add performance tracking (10 min)
```typescript
// File: apps/web/src/lib/performance-monitor.ts
export class PerformanceMonitor {
  private metrics = new Map<string, number[]>();
  
  measure<TArgs extends any[], T>(name: string, fn: (...args: TArgs) => Promise<T>) {
    return async (...args: TArgs): Promise<T> => {
      const start = performance.now();
      const result = await fn(...args);
      const duration = performance.now() - start;
      
      if (!this.metrics.has(name)) {
        this.metrics.set(name, []);
      }
      this.metrics.get(name)!.push(duration);
      
      return result;
    };
  }
  
  getStats(name: string) {
    const times = this.metrics.get(name) || [];
    return {
      avg: times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0,
      min: times.length ? Math.min(...times) : 0,
      max: times.length ? Math.max(...times) : 0,
      count: times.length
    };
  }
}
```

#### Subtask 7.1.2: Track migration metrics (10 min)
```typescript
// File: apps/web/src/lib/migration-tracker.ts
export function trackMigration() {
  const metrics = {
    timestamp: Date.now(),
    electronApiCalls: 0,
    nextApiCalls: 0,
    routerType: isFeatureEnabled('USE_NEXTJS_ROUTING') ? 'next' : 'tanstack',
    errors: []
  };
  
  // Send to analytics or log
  console.log('Migration metrics:', metrics);
  
  return metrics;
}
```

#### Subtask 7.1.3: Create dashboard (10 min)
```typescript
// File: apps/web/src/components/dev/migration-dashboard.tsx
export function MigrationDashboard() {
  const [metrics, setMetrics] = useState(null);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics(trackMigration());
    }, 5000);
    
    return () => clearInterval(interval);
  }, []);
  
  if (!metrics || process.env.NODE_ENV !== 'development') return null;
  
  return (
    <div className="fixed top-4 right-4 p-4 bg-black/80 text-white rounded">
      <h4>Migration Status</h4>
      <pre>{JSON.stringify(metrics, null, 2)}</pre>
    </div>
  );
}
```

---

## Emergency Procedures

### 8.1 Quick Rollback (10 min)

```bash
# File: scripts/emergency-rollback.sh
#!/bin/bash

echo "⚠️ EMERGENCY ROLLBACK IN PROGRESS..."

# 1. Restore from backup
git stash
git checkout migration/remove-nextjs-backup

# 2. Reset environment
echo "VITE_USE_ELECTRON_API=false" > apps/web/.env.local
echo "VITE_USE_NEXTJS_ROUTING=true" >> apps/web/.env.local

# 3. Reinstall dependencies
cd apps/web && bun install

# 4. Start with old setup
bun run dev:next

echo "✅ Rollback complete. System running on Next.js"
```

### 8.2 Partial Rollback (15 min)

```bash
# File: scripts/partial-rollback.sh
#!/bin/bash

# Roll back only specific features
case "$1" in
  "api")
    echo "VITE_USE_ELECTRON_API=false" >> apps/web/.env.local
    echo "✅ Rolled back to Next.js API routes"
    ;;
  "router")
    echo "VITE_USE_NEXTJS_ROUTING=true" >> apps/web/.env.local
    echo "✅ Rolled back to Next.js routing"
    ;;
  *)
    echo "Usage: ./partial-rollback.sh [api|router]"
    ;;
esac
```

---

## Success Criteria Checklist

### Must Pass (No Feature Breaking)
- [ ] All existing features work identically
- [ ] No data loss during migration
- [ ] Performance not degraded
- [ ] All tests passing
- [ ] Electron packaging successful
- [ ] Export functionality intact

### Should Achieve
- [ ] Bundle size < 1.5MB
- [ ] Build time < 30s
- [ ] Dev server start < 5s
- [ ] Type coverage > 95%
- [ ] 0 Next.js dependencies

### Nice to Have
- [ ] Bundle size < 1.2MB
- [ ] Build time < 20s
- [ ] 100% type coverage
- [ ] Automated migration tests

---

## Timeline Summary

| Day | Phase | Hours | Critical Tasks |
|-----|-------|-------|----------------|
| 1-2 | Assessment | 16 | Inventory, backup, feature flags |
| 3-5 | API Migration | 24 | Convert all API routes to IPC |
| 6-7 | Router Migration | 16 | Parallel routing implementation |
| 8-9 | Dependency Removal | 16 | Safe removal with rollback |
| 10-11 | Testing | 16 | Comprehensive validation |
| 12-13 | Rollout | 16 | Gradual deployment |
| 14-15 | Cleanup | 16 | Documentation, monitoring |

**Total**: 120 hours (15 working days)

## Conclusion

This migration plan ensures zero downtime and no feature breakage through:
1. **Parallel implementation** with feature flags
2. **Gradual rollout** with monitoring
3. **Comprehensive testing** at each stage
4. **Multiple rollback options** for safety
5. **Detailed subtasks** under 10 minutes each

The key to success is maintaining both systems functional during migration, allowing instant rollback if issues arise.