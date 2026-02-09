# Changelog

All notable changes to QCut will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.56] - 2026-02-09

## [0.3.55] - 2026-02-09

## [0.3.54] - 2026-02-08

### Added
- AI content pipeline skill with 51 models across 8 categories
- Speech-to-text transcription with ElevenLabs Scribe v2
- Project folder organization skill
- Virtual folder system for media management

### Changed
- Improved media import with symlink support
- Enhanced error handling in IPC handlers

### Fixed
- Media import error handling for unexpected symlink failures
- Path validation in list-files and ensure-structure handlers

## [0.3.52] - 2025-01-31

### Added
- Skills system with default skills bundled in resources
- FFmpeg skill for video/audio processing
- Organize-project skill for project structure management

### Changed
- Simplified execWithTimeout using promisify in AI pipeline
- Improved documentation for organize-project skill

### Fixed
- Various bug fixes and stability improvements

## [0.3.0] - 2025-01-15

### Added
- Electron desktop application
- Timeline-based video editing
- Media panel with drag-and-drop support
- FFmpeg WebAssembly integration for client-side processing
- Auto-update functionality

### Changed
- Migrated from Next.js to Vite + TanStack Router

## [0.2.0] - 2025-01-01

### Added
- Initial project structure
- Basic video playback
- Project management system

## [0.1.0] - 2024-12-15

### Added
- Initial release
- Core video editor framework
- React-based UI components

[Unreleased]: https://github.com/qcut-team/qcut/compare/v0.3.52...HEAD
[0.3.52]: https://github.com/qcut-team/qcut/compare/v0.3.0...v0.3.52
[0.3.0]: https://github.com/qcut-team/qcut/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/qcut-team/qcut/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/qcut-team/qcut/releases/tag/v0.1.0
