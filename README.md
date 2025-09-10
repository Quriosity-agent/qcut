<table width="100%">
  <tr>
    <td align="left" width="120">
      <img src="qcut/apps/web/public/assets/logo-v4.png" alt="QCut Logo" width="100" />
    </td>
    <td align="right">
      <h1>QCut <span style="font-size: 0.7em; font-weight: normal;"></span></h1>
      <h3 style="margin-top: -10px;">A free, open-source video editor for Windows desktop (and web).</h3>
    </td>
  </tr>
</table>

## Why?

- **Privacy**: Your videos stay on your device
- **Free features**: Every basic feature of CapCut is paywalled now
- **Simple**: People want editors that are easy to use - CapCut proved that

## Features

- **Native Windows Desktop App** - Runs completely offline with native file access
- **Timeline-based editing** - Professional video editing interface
- **Multi-track support** - Audio and video tracks with drag-and-drop
- **Real-time preview** - Instant feedback while editing
- **FFmpeg Integration** - Professional-grade video processing via WebAssembly
- **AI-Powered Features** - Text-to-image generation, background removal, and more
- **Sound Library** - Integrated library with search and commercial-use filtering
- **Stickers & Graphics** - Rich icon library with Iconify integration
- **Text Overlays** - Customizable text elements with positioning and animations
- **Local File System** - Native file dialogs and direct file access
- **No watermarks or subscriptions** - Completely free forever
- **Privacy-first** - All processing happens locally on your device

## Project Structure

```
qcut/
├── apps/web/                    # Main Vite + React application
│   └── src/
│       ├── components/          # UI and editor components
│       │   ├── editor/         # Video editor components
│       │   └── ui/             # Reusable UI components
│       ├── hooks/              # Custom React hooks
│       ├── lib/                # Utilities, FFmpeg, and helpers
│       ├── routes/             # TanStack Router pages
│       ├── stores/             # Zustand state management
│       └── types/              # TypeScript definitions
├── electron/                    # 100% TypeScript Electron backend
│   ├── main.ts                 # Main process (TypeScript)
│   ├── preload.ts              # Preload script (TypeScript)
│   ├── *-handler.ts            # All IPC handlers (TypeScript)
│   └── dist/                   # Compiled JavaScript output
├── packages/                    # Shared packages (monorepo)
│   ├── auth/                   # Authentication logic
│   └── db/                     # Database utilities
└── docs/                       # Documentation and guides

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed on your system:

- [Node.js](https://nodejs.org/en/) (v18 or later)
- [Bun](https://bun.sh/docs/installation) - Package manager and bundler
- [Git](https://git-scm.com/) - For cloning the repository

> **Note:** The Windows desktop app runs completely offline and doesn't require Docker, databases, or external services. Just Node.js and Bun are sufficient for building and running the Electron application.

### Quick Start (Windows Desktop App)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/donghaozhang/qcut.git
   cd qcut
   ```

2. **Install dependencies:**
   ```bash
   bun install
   ```

3. **Build and run the desktop app:**
   ```bash
   # Build the web app
   cd qcut/apps/web
   bun run build
   
   # Run the Electron app
   cd ../..
   bun run electron
   ```

   **Or use development mode for hot reload:**
   ```bash
   # Terminal 1: Start Vite dev server
   cd qcut/apps/web
   bun run dev
   
   # Terminal 2: Run Electron in dev mode
   cd qcut
   bun run electron:dev
   ```

The QCut desktop application will launch with the complete video editing interface!

## Development Setup

### Desktop App Development

For developing the Electron desktop application:

#### **Recommended Development Workflow:**

1. **Terminal 1 - Frontend (hot reload):**
   ```bash
   cd qcut/apps/web
   bun run dev
   ```
   The Vite dev server will start at `http://localhost:5173`

2. **Terminal 2 - TypeScript Backend (auto-compile):**
   ```bash
   cd qcut
   bun run build:electron:watch
   ```
   This will automatically recompile TypeScript files when you modify Electron backend code

3. **Terminal 3 - Electron App:**
   ```bash
   cd qcut
   bun run electron:dev
   ```
   Launch Electron in development mode (restart when backend changes)

This workflow provides **hot reload for frontend** and **automatic compilation for backend** changes.

### Available Scripts

From the project root (`qcut/`):
- `bun run electron` - Run the Electron app in production mode
- `bun run electron:dev` - Run Electron in development mode  
- `bun run build` - Build all packages (includes TypeScript compilation)
- `bun run dist:win` - Build Windows installer (.exe)
- `bun run lint` - Run linting with Biome
- `bun run format` - Auto-format code with Biome

From `qcut/apps/web/`:
- `bun run dev` - Start Vite development server (port 5173)
- `bun run build` - Build the production bundle
- `bun run preview` - Preview the production build
- `bun run lint:fix` - Auto-fix linting issues

**TypeScript Development:**
- `bun run build:electron` - Compile TypeScript files (one-time)
- `bun run build:electron:watch` - Auto-recompile on file changes (recommended for development)
- `bun run check-types` - Type checking across workspace

### Building for Distribution

To create a Windows executable:

```bash
# Option 1: Using electron-packager (recommended for development)
cd qcut
npx electron-packager . QCut --platform=win32 --arch=x64 --out=dist-packager --overwrite

# Option 2: Using electron-builder (for production installer)
cd qcut/apps/web
bun run build
cd ../..
bun run dist:win
```

> **Note:** The packaged app will be created in the `dist-packager/` directory, and the installer in the `dist-electron/` directory.

## Architecture

QCut uses a modern desktop application stack:

- **Frontend**: Vite 7 + React 18.3.1 + TanStack Router (hash-based routing)
- **Desktop**: Electron 37.4.0 with **100% TypeScript** backend and secure IPC communication
- **Video Processing**: FFmpeg via WebAssembly (@ffmpeg/ffmpeg)
- **Styling**: Tailwind CSS 4 with custom dark theme
- **State Management**: Zustand stores (editor, timeline, project, media)
- **File System**: Native Electron file dialogs and operations
- **Storage**: Multi-tier (Electron IPC → IndexedDB → localStorage)
- **UI Components**: Radix UI primitives + custom components
- **Monorepo**: Turborepo with Bun workspaces

## TypeScript Architecture

QCut features a **100% TypeScript Electron backend** with comprehensive type safety:

### ✅ **Fully Converted Components**

- **Main Process**: `electron/main.ts` - Complete Electron main process with all IPC handlers
- **Preload Script**: `electron/preload.ts` - Type-safe renderer process bridge
- **IPC Handlers**: All 19 handlers converted with comprehensive interfaces:
  - `api-key-handler.ts` - Secure API key management
  - `ffmpeg-handler.ts` - Video processing with FFmpeg
  - `sound-handler.ts` - Audio/sound effects handling
  - `transcribe-handler.ts` - AI transcription services
  - `theme-handler.ts` - Application theming
  - `temp-manager.ts` - Temporary file management
  - `audio-temp-handler.ts` - Audio file processing

### 🔧 **Development Workflow**

1. **Source Files**: Write TypeScript in `electron/*.ts`
2. **Compilation**: Files compile to `dist/electron/*.js` via `bun x tsc`
3. **Execution**: Electron runs from compiled JavaScript files
4. **Type Safety**: Full IntelliSense and compile-time error checking

### 🎯 **Type Safety Benefits**

- **Zero Runtime Type Errors**: All IPC communications are strictly typed
- **Enhanced Developer Experience**: Full IntelliSense support for all handlers
- **Maintainable Codebase**: Self-documenting interfaces and comprehensive error handling
- **Future-Proof**: Type-safe refactoring and easy feature additions

## Contributing

We welcome contributions! The project has been successfully migrated to a desktop-first architecture.

**Quick start for contributors:**

- Fork the repo and clone locally
- Follow the Quick Start instructions above
- Create a feature branch and submit a PR

## Technical Notes

### Key Technologies

- **Hybrid Architecture**: Maintains compatibility with both Next.js patterns and TanStack Router
- **Dynamic Imports**: Lazy loading for better performance (stores, components)
- **WebAssembly FFmpeg**: Client-side video processing without server dependencies
- **Electron IPC**: Secure communication between renderer and main process
- **File Handling**: Native drag-and-drop, file dialogs, and direct file system access

### Performance Optimizations

- Lazy-loaded stores and components
- Virtual scrolling for large lists
- Optimized timeline rendering
- Efficient media caching
- WebAssembly for compute-intensive tasks

### Recent Improvements (v0.3.48) - MAJOR TYPESCRIPT CONVERSION ✅

- **🎉 100% TypeScript Electron Backend**: Complete conversion of all Electron main process files from JavaScript to TypeScript
- **Full IPC Handler Migration**: All 19 IPC handlers successfully converted with comprehensive type safety
- **Enhanced Error Handling**: Comprehensive TypeScript error management across all handlers
- **Protocol Handler Fixed**: Complete resolution of `app://` protocol file loading issues
- **Path Resolution**: Fixed all import and file paths for compiled TypeScript structure  
- **Build Process**: Clean TypeScript compilation with no errors and full type safety
- **Test Framework**: Comprehensive test suite with 200+ passing tests (Vitest + @testing-library/react)

### Known Limitations

- API routes from Next.js structure are non-functional (use Electron IPC instead)
- Some advanced features still in development (transcription, AI features)
- FFmpeg WebAssembly files need special handling in linting
- Frontend TypeScript coverage could be improved (backend is 100% complete)

## Troubleshooting

### Common Issues

**Build Errors:**
- Run `bun install` to ensure all dependencies are installed
- Use `bun run lint:clean` instead of `bun lint` to skip FFmpeg WebAssembly parsing errors
- Check that you're using the correct Node.js version (v18+)

**Electron App Won't Start:**
- Ensure you've built the web app first: `cd qcut/apps/web && bun run build`
- Try running in development mode: `bun run electron:dev`
- Check that all required files are present in `electron/` directory

**API Errors:**
- If you see `window.electronAPI.invoke is not a function`, make sure you're using structured API calls
- Example: Use `window.electronAPI.sounds.search()` instead of `window.electronAPI.invoke("sounds:search")`
- Check the preload script is properly configured

**TypeScript Compilation Issues:**
- Run `cd electron && bun x tsc` to manually compile TypeScript files
- Check `electron/tsconfig.json` for correct configuration
- Ensure all dependencies have proper type definitions
- Verify import paths use `.js` extensions for compiled output

**Performance Issues:**
- Close unnecessary browser tabs if running in development mode
- Ensure sufficient RAM available (recommended 8GB+)
- Check if antivirus software is interfering with file operations

**TypeScript Development Tips:**
- All Electron backend code is now TypeScript - edit `.ts` files, not `.js`
- After TypeScript changes, recompile with `bun x tsc` from the `electron/` directory
- Use `bun run build` to build the entire project including TypeScript compilation
- Compiled JavaScript files in `dist/electron/` are auto-generated - don't edit them directly
