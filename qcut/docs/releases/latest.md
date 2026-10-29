---
version: "2026.10.29.2"
date: "2026-10-29"
channel: "stable"
---

# QCut v2026.10.29.2

### Changed

- `"collision": "insert"` moves the later clips only as far as the new one needs: a clip put back into the gap a delete left (to within half a frame) moves nothing, where it used to push everything after it by its whole length. Where a clip starts at the insert point, or is split there, they still move by the whole length.
- `timeline export` lists each track's elements in time order.

### Fixed

- `project:rename` and moving a project to a folder no longer put back an older copy of the project: the master curve, buses and other settings changed since the project list was last read survived on disk only until a rename, and in the editor too. A duplicate of the open project copies it as the editor holds it. A mixer command whose change could not be saved answers with an error instead of ok, and a track's mixer change is saved before the command answers.
- Ripple deletes (the main-track magnet's too), ripple moves, ripple trims and `track:delete --ripple` close up a clip that starts a rounding error before the edit point; the gap stayed open where a clip ended 0.1 ms after the next one started.
