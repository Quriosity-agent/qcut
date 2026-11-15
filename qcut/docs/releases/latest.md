---
version: "2026.11.15.3"
date: "2026-11-15"
channel: "stable"
---

# QCut v2026.11.15.3

### Added

- Added an opt-in macOS controller for mounting an APFS local-asset image at a checkout’s original `.local` path. It validates volume identity and permissions, guards the offline mountpoint, and refuses conflicting or busy attachments (#541).

### Fixed

- Native beauty audits now preserve bounded debugger failure details before host protocol validation and through process cleanup, making intermittent failures easier to diagnose (#542).

### Known limitation

- The intermittent native beauty debugger stop is still under investigation. This release improves diagnostics; it does not claim to resolve that stop. Local-asset mounting remains explicit and does not automatically move or delete user data.
