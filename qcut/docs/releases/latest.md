---
version: "2026.11.15.1"
date: "2026-11-15"
channel: "stable"
---

# QCut v2026.11.15.1

### Fixed

- Packaged desktop builds can persist and reuse portrait beauty preview frames again. Cache identities now bind to the installed ASAR archive and its relevant entries, while rejecting replaced archives, changed runtime dependencies and unsafe paths. Development builds retain their existing file identity checks.
