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
├── electron/                    # Electron main and preload scripts
│   ├── main.js                 # Main process
│   └── preload.js              # Preload script for IPC
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

1. **Start the Vite development server:**
   ```bash
   cd qcut/apps/web
   bun run dev
   ```
   The dev server will start at `http://localhost:5173`

2. **In another terminal, run Electron in development mode:**
   ```bash
   cd qcut
   bun run electron:dev
   ```

This will launch Electron with hot reload capabilities for development.

### Available Scripts

From the project root (`qcut/`):
- `bun run electron` - Run the Electron app in production mode
- `bun run electron:dev` - Run Electron in development mode
- `bun run dist:win` - Build Windows installer (.exe)
- `bun run lint` - Run linting with Biome
- `bun run format` - Auto-format code with Biome

From `qcut/apps/web/`:
- `bun run dev` - Start Vite development server (port 5173)
- `bun run build` - Build the production bundle
- `bun run preview` - Preview the production build
- `bun run lint:fix` - Auto-fix linting issues

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

- **Frontend**: Vite 7 + React 19 + TanStack Router (hash-based routing)
- **Desktop**: Electron 37 with secure IPC communication
- **Video Processing**: FFmpeg via WebAssembly (@ffmpeg/ffmpeg)
- **Styling**: Tailwind CSS 4 with custom dark theme
- **State Management**: Zustand stores (editor, timeline, project, media)
- **File System**: Native Electron file dialogs and operations
- **Storage**: Multi-tier (Electron IPC → IndexedDB → localStorage)
- **UI Components**: Radix UI primitives + custom components
- **Monorepo**: Turborepo with Bun workspaces

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

### Recent Improvements (v0.3.38)

- **Fixed Runtime Errors**: Resolved `window.electronAPI.invoke is not a function` with proper structured API
- **Enhanced Type Safety**: Complete TypeScript definitions for all Electron API methods
- **Improved Error Handling**: Better null checks and validation throughout the codebase
- **Clean Builds**: No TypeScript compilation errors, production-ready state

### Known Limitations

- API routes from Next.js structure are non-functional (use Electron IPC instead)
- Some advanced features still in development (transcription, AI features)
- FFmpeg WebAssembly files need special handling in linting
- Test suite implementation in progress

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

**Performance Issues:**
- Close unnecessary browser tabs if running in development mode
- Ensure sufficient RAM available (recommended 8GB+)
- Check if antivirus software is interfering with file operations
