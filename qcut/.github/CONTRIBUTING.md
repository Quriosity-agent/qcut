# Contributing to QCut

Thank you for your interest in contributing to QCut! This document provides guidelines and instructions for contributing.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/en/) 20.19+ or 22.12+ (required by Vite 7)
- [Bun](https://bun.sh/docs/installation) 1.3.10
  (for `npm` alternative)

### Setup

1. Fork the repository
2. Clone your fork locally
3. Navigate to the web app directory: `cd apps/web`
4. Copy `.env.example` to `.env.local`:

   ```bash
   # Unix/Linux/Mac
   cp .env.example .env.local

   # Windows Command Prompt
   copy .env.example .env.local

   # Windows PowerShell
   Copy-Item .env.example .env.local
   ```

5. Install dependencies: `bun install`
6. Start the development server: `bun run dev`

> **Note:** If you see an error like `Unsupported URL Type "workspace:*"` when running `npm install`, you have two options:
>
> 1. Upgrade to a recent npm version (v9 or later), which has full workspace protocol support.
> 2. Use an alternative package manager such as **bun** or **pnpm**.

## What to Focus On

**🎯 Good Areas to Contribute:**

- Timeline functionality and UI improvements
- Project management features
- Performance optimizations
- Bug fixes in existing functionality
- UI/UX improvements
- Documentation and testing

**⚠️ Areas to Avoid:**

- Preview panel enhancements (text fonts, stickers, effects)
- Export functionality improvements
- Preview rendering optimizations

**Why?** We're currently planning a major refactor of the preview system. The current preview renders DOM elements (HTML), but we're moving to a binary rendering approach similar to CapCut. This new system will ensure consistency between preview and export, and provide much better performance and quality.

The current HTML-based preview is essentially a prototype - the binary approach will be the "real deal." To avoid wasted effort, please focus on other areas of the application until this refactor is complete.

If you're unsure whether your idea falls into the preview category, feel free to ask us [directly in discord](https://discord.gg/zmR9N35cjK) or create a GitHub issue!

## Development Setup

### Local Development

1. Install dependencies from the `qcut/` directory:

   ```bash
   bun install
   ```

2. Optionally copy `apps/web/.env.example` to `apps/web/.env.local` to set `VITE_*` options. AI provider keys can also be added later in the app's API key settings.

3. Build once, then start the desktop app:

   ```bash
   bun run build
   bun run electron
   ```

4. For hot reload, run the Vite dev server and Electron in two terminals:

   ```bash
   bun run --cwd apps/web dev  # terminal 1: Vite dev server
   bun run electron:dev        # terminal 2: Electron in development mode
   ```

   Rerun `bun run build:electron` after changing files under `electron/`.

## How to Contribute

### Reporting Bugs

- Use the bug report template
- Include steps to reproduce
- Provide screenshots if applicable

### Suggesting Features

- Use the feature request template
- Explain the use case
- Consider implementation details

### Code Contributions

1. Create a new branch: `git checkout -b feature/your-feature-name`
2. Make your changes
3. Navigate to the web app directory: `cd apps/web`
4. Run the linter: `bun run lint`
5. Format your code: `bunx biome format --write .`
6. Commit your changes with a descriptive message
7. Push to your fork and create a pull request

## Code Style

- We use Biome for code formatting and linting
- Run `bunx biome format --write .` from the `apps/web` directory to format code
- Run `bun run lint` from the `apps/web` directory to check for linting issues
- Follow the existing code patterns

## Pull Request Process

1. Fill out the pull request template completely
2. Link any related issues
3. Ensure CI passes
4. Request review from maintainers
5. Address any feedback

## Community

- Be respectful and inclusive
- Follow our Code of Conduct
- Help others in discussions and issues

Thank you for contributing!
