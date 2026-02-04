# README.md Simplification & Update Tasks

> Goal: Streamline README, move detailed content to `docs/technical/`
> Status: **COMPLETED**

---

## Simplification Strategy

| Keep in README | Move to Technical Docs |
|----------------|------------------------|
| Intro, Why, Core Features | Full Features list |
| Quick Start (5 steps max) | Detailed dev setup |
| Simple architecture overview | Full project structure, Handler list |
| Basic commands | Complete script reference |
| Links to technical docs | TypeScript architecture details |

---

## Execution Tasks

### Phase 1: Update Content (High Priority)

- [x] **1.1** Update title: "Windows desktop" → "Windows, macOS, and Linux"
- [x] **1.2** Trim Features to 6-8 core items, remove details
- [x] **1.3** Remove detailed "Project Structure" directory tree, link to [source-code-structure.md](../technical/architecture/source-code-structure.md)
- [x] **1.4** Remove entire "TypeScript Architecture" section, link to technical docs

### Phase 2: Simplify Commands (Medium Priority)

- [x] **2.1** Simplify Quick Start to 3 steps
- [x] **2.2** Remove detailed "Development Setup", link to [build-commands.md](../technical/guides/build-commands.md)
- [x] **2.3** Add cross-platform build commands (`dist:mac`, `dist:linux`)

### Phase 3: Add Links Section (Low Priority)

- [x] **3.1** Add "Documentation" section linking to:
  - `docs/technical/README.md` - Technical docs index
  - `docs/technical/architecture/` - Architecture details
  - `docs/technical/ai/` - AI features documentation
  - `docs/technical/guides/` - Development guides

---

## Result

**Before:** ~300 lines
**After:** ~75 lines

### Sections Removed
- [x] "Project Structure" detailed directory tree
- [x] "Development Setup" multi-terminal instructions
- [x] "Available Scripts" detailed list
- [x] "Building for Distribution" detailed options
- [x] "Architecture" detailed tech stack
- [x] "TypeScript Architecture" entire section
- [x] "Technical Notes" entire section
- [x] "Troubleshooting" entire section

### Sections Added
- [x] "Documentation" table with links to technical docs
- [x] "Build for Distribution" with cross-platform commands
- [x] Simplified "Tech Stack" one-liner format
