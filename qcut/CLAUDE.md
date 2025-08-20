# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Priority Hierarchy: Long-term maintainability > scalability > performance > short-term gains

## Essential Commands

### Linting & Code Quality
```bash
# Run standard linting (shows all errors including unfixable FFmpeg files)
bun lint

# Run clean linting (skips parse errors from FFmpeg WebAssembly files) - RECOMMENDED
bun lint:clean

# Auto-fix formatting issues
bun format
```

Core Principles:

Systems Thinking: Analyze impacts across entire system
Future-Proofing: Design decisions that accommodate growth
Dependency Management: Minimize coupling, maximize cohesion

frontend: UI/UX and user-facing development

### Code Documentation
- Write self-documenting code with clear naming
- Add JSDoc comments for complex functions
- Document API interfaces and types
- Include usage examples for reusable components

## Project Overview

QCut is a desktop video editor built with a **hybrid architecture** combining Vite + TanStack Router + Electron. The project maintains both Next.js-style and TanStack Router structures, indicating either an ongoing migration or dual compatibility design. It uses a monorepo structure with Bun as the package manager.

## Key Architecture

### Tech Stack
- **Frontend**: Vite 7.0.6, TanStack Router (Hash History), React 19, TypeScript
- **Desktop**: Electron 37.2.5 with IPC handlers for file operations
- **State Management**: Zustand stores (editor-store, timeline-store, project-store)
- **Video Processing**: FFmpeg WebAssembly (@ffmpeg/ffmpeg)
- **Storage**: Multi-tier system (Electron IPC → IndexedDB → localStorage fallback)
- **Styling**: Tailwind CSS 4.1.11
- **UI Components**: Radix UI primitives
- **Monorepo**: Turborepo with Bun

### **🏗️ Hybrid Architecture Details**

**Dual Routing System:**
- **Primary**: TanStack Router (`src/routes/` + `routeTree.gen.ts`)
- **Secondary**: Next.js-style structure (`src/app/` with page.tsx files)
- **API Routes**: Next.js format (`src/app/api/` with route.ts files) - **⚠️ Non-functional in Vite**

**Key Implications:**
- Vite dev server **does not execute** Next.js API routes
- API calls to `/api/sounds/search` will fail with `net::ERR_FILE_NOT_FOUND`
- Use **Electron IPC** for backend functionality instead of API routes

### Project Structure
```
qcut/
├── apps/web/                    # Main Vite app
│   └── src/
│       ├── app/                 # Next.js-style structure (legacy/compatibility)
│       │   ├── api/            # ⚠️ API routes exist but non-functional in Vite
│       │   └── */page.tsx      # Next.js-style pages
│       ├── routes/             # ✅ Active TanStack Router routes
│       │   ├── __root.tsx
│       │   └── *.tsx
│       └── routeTree.gen.ts    # Generated router tree
├── packages/
│   ├── auth/                    # @qcut/auth
│   └── db/                      # @qcut/db
├── electron/                    # Electron main and preload scripts
└── docs/task/                   # Migration documentation
```



### Core Editor Architecture
- **Timeline System**: Custom implementation in `src/components/editor/timeline/`
- **State Management**: Multiple Zustand stores for separation of concerns
- **Storage**: Abstraction layer supporting IndexedDB and OPFS
- **Media Processing**: Client-side FFmpeg with WebAssembly

## Git Commit Guidelines

**IMPORTANT**: When creating git commits:
- DO NOT include "Co-Authored-By: Claude" attribution
- DO NOT include the 🤖 emoji or "Generated with Claude Code" message
- Use conventional commit format: `type: description`
- Keep commit messages concise and descriptive

## Development Commands

### Root Level
```bash
bun dev          # Start all apps in development
bun build        # Build all packages and apps
bun check-types  # Type checking across workspace
bun lint         # Lint with Ultracite/Biome
bun format       # Format with Ultracite/Biome
```

### Web App (apps/web/)
```bash
bun dev                  # Vite dev server (port 5173)
bun build                # Production build
bun lint:fix             # Auto-fix linting issues
```

### Database Setup
```bash
# Docker services required:
docker-compose up -d     # PostgreSQL (5432), Redis (6379)
```

## Electron Build & Distribution

### Development
```bash
bun run electron         # Run Electron app (production mode)
bun run electron:dev     # Run Electron app (development mode)
```

### Building EXE
```bash
# Option 1: Using electron-packager (recommended)
npx electron-packager . QCut --platform=win32 --arch=x64 --out=dist-packager --overwrite

# Option 2: Using electron-builder (if configured)
bun run dist:win
```
## Important Patterns

### State Management
```typescript
// Zustand stores in src/stores/
useEditorStore()    // Main editor state
useTimelineStore()  // Timeline operations
useProjectStore()   // Project management
usePlaybackStore()  // Video playback
```

### Storage Abstraction
```typescript
// src/lib/storage/
StorageService with IndexedDBAdapter or OPFSAdapter
```

### Timeline Components
- `TimelineTrack` - Individual tracks
- `TimelineElement` - Media elements on timeline
- `TimelinePlayhead` - Current position indicator

## Environment Variables
```bash
DATABASE_URL            # PostgreSQL connection
BETTER_AUTH_SECRET      # Authentication
UPSTASH_REDIS_REST_URL  # Redis for rate limiting
MARBLE_WORKSPACE_KEY    # Blog CMS
```

## Code Style
- **Linting**: Biome with Ultracite configuration
- **Many lint rules disabled** - be aware when adding new code
- **Path aliases**: Use `@/` for `src/` imports

## Testing
**⚠️ No testing framework currently configured** - This is a known gap

## Key Files to Understand
- `apps/web/src/routes/editor.$project_id.tsx` - Main editor entry
- `apps/web/src/stores/timeline-store.ts` - Timeline state logic
- `apps/web/src/lib/ffmpeg-utils.ts` - Video processing
- `apps/web/src/components/editor/timeline/` - Timeline UI components

# QCut – Top 10 Accessibility Rules to Always Enforce

These ten rules catch the most frequent and most critical a11y bugs in a React + Electron (Chromium) environment. Add them to your lint setup and PR checklist first.

| # | Rule | Why It Matters |
|---|------|----------------|
| **1** | **Provide a meaningful `alt` text for every image/icon that requires it.** | Screen-reader users rely on `alt`; missing or vague descriptions leave them with zero context. |
| **2** | **Never place `aria-hidden="true"` on focusable elements.** | The element is still tabbable, but the assistive tech can’t read it – a dead end for keyboard users. |
| **3** | **Every `<button>` *must* specify `type="button"` or `type="submit"`.** | Avoids accidental form submission and clarifies intent. |
| **4** | **Ensure every `<a>` tag contains meaningful, screen-reader-friendly content and a valid `href`.** | “Empty” or icon-only links announce as “link” with no context or go nowhere. |
| **5** | **If you add `onClick`, also support keyboard (`onKeyDown`/`onKeyUp`).** | Click-only handlers are unusable via keyboard or assistive switches. |
| **6** | **Give every SVG icon a `<title>` element that describes its purpose.** | Without it, readers just announce “graphic” or skip the icon entirely. |
| **7** | **Do not set `tabIndex` on non-interactive elements.** | Arbitrary focus order confuses keyboard navigation and breaks logical flow. |
| **8** | **Use semantic elements instead of roles (`<button>` > `<div role="button">`).** | Native elements come with keyboard focus, states, and ARIA roles out of the box. |
| **9** | **Heading tags (`<h1>` … `<h6>`) must contain real, visible text (not hidden via `aria-hidden`).** | Screen readers rely on the heading hierarchy for quick navigation. |
| **10** | **For every table header `<th>`, set the correct `scope` (“row”, “col”).** | Gives assistive tech enough info to announce the correct header–cell relationship. |

# QCut – Top 5 Code-Complexity & Quality Rules to Enforce First

| # | Rule | Why It Pays Off Immediately |
|---|------|-----------------------------|
| **1** | **Use `for…of` instead of `Array.forEach`.** | `forEach` swallows `await`/`return`, prevents early-exit, and complicates error handling. `for…of` is clearer, supports `break` / `continue`, and works perfectly with `await`. |
| **2** | **Set a Cognitive-Complexity ceiling for every function.** | Stops “God functions” from landing in the codebase; forces decomposition into smaller, testable helpers and keeps reviews manageable. |
| **3** | **Ban the legacy `arguments` object; use rest parameters (`...args`).** | Rest parameters are iterable, type-safe, and compatible with arrow functions—essential for clean TypeScript and better IntelliSense. |
| **4** | **Disallow `any` / `unknown` as type constraints.** | The single biggest source of hidden runtime bugs. Removing it preserves strong typing and makes large-scale refactors safe. |
| **5** | **Forbid reassigning `const` variables and eliminate `var`.** | Guarantees immutability by default, avoids hoisting surprises, and simplifies reasoning about state—especially in asynchronous flows. |

> **Implementation tip:** add these rules to your Ultracite (Biome) config at **error** level first; they deliver the highest value-to-refactor ratio for an existing QCut codebase.


## Current Limitations
1. No test suite
2. Limited error handling
3. No performance monitoring
4. Basic export functionality (needs enhancement)
5. **Hybrid architecture complexity** - dual routing and API systems

## When Working on Features
1. Always test both `bun run electron:dev` (development) and `bun run electron` (production)
2. Test EXE builds with `npx electron-packager` after major changes
3. Ensure FFmpeg paths work in both dev and packaged environments
4. Use Electron IPC for all file system operations
5. **⚠️ CRITICAL: Never rely on Next.js API routes** - they don't work in Vite environment

## Architecture Guidelines

### ✅ **DO** - Recommended Patterns
- **Routing**: Use TanStack Router (`src/routes/`) for new features
- **Backend Logic**: Implement via Electron IPC handlers in `electron/main.js`
- **State Management**: Use Zustand stores in `src/stores/`
- **Environment Variables**: Use `VITE_` prefix for client-side variables
- **Image Components**: Consider dual Next.js/Vite compatibility when needed

### ❌ **DON'T** - Avoid These Patterns  
- **API Routes**: Don't expect `src/app/api/` routes to work in Vite
- **Server-side Logic**: Don't put backend logic in client-side components
- **process.env**: Don't use `process.env` in client code (use `import.meta.env`)
- **Next.js Dependencies**: Don't add features that require Next.js runtime

### 🔧 **Migration Strategy**
When encountering Next.js patterns that don't work in Vite:
1. **API Routes** → Convert to Electron IPC handlers
2. **Server Components** → Convert to client components with IPC calls
3. **process.env** → Convert to `import.meta.env.VITE_*`
4. **Next.js Image** → Use regular `<img>` or create compatibility wrapper