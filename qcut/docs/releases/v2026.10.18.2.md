---
version: "2026.10.18.2"
date: "2026-10-18"
channel: "stable"
---

# QCut v2026.10.18.2

- Beauty controls now follow the installed independent engine's capabilities; switching engines clears stale capability and error state.
- Manual body zoom uses a finite mesh matching the validated native geometry, with owned Metal rendering.
- Add an opt-in offline single-person body sequence API with persistent geometry, video face recovery, and explicit reset/replay cancellation.
- Validate all ten smart body controls plus three manual tools through 1080p desktop preview and export, and preserve the production photo renderer's eight same-image updates.

The offline temporal API is not yet connected to the editor's stateless preview/export adapter. Original model weights are still required for learned perception; multi-person tracking and long-video acceptance remain incomplete.

Details: [PR #508](https://github.com/Quriosity-agent/qcut/pull/508).
