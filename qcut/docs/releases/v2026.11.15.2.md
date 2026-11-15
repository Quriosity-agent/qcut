---
version: "2026.11.15.2"
date: "2026-11-15"
channel: "stable"
---

# QCut v2026.11.15.2

### Fixed

- A long `editor:timeline:apply` no longer fails with `Track not found`. Every change to the timeline made the editor read every clip again, whole, to tell listeners what had changed; with a 3D LUT on sixty clips each added clip re-read tens of megabytes, so the apply ran past the 30 seconds its transaction lasts, QCut rolled the timeline back under it, and the next request found its track gone. A clip is now read once, when it changes. A 30-track, 213-clip manifest with an 18-point LUT on 60 clips held the transaction for 52–61 s before and takes 15–20 s now; a 22 MB manifest (216 clips, 63 LUTs of 25 points) that could not be applied at all takes 6 s. The apply also asks for a transaction that lasts as long as its manifest needs (it grows with the clips, the tracks and the size, up to QCut's 5 minutes), and `POST /api/claude/transaction/begin` takes `timeoutMs`.
- A failed `editor:timeline:apply --atomic` says what the timeline is now. `rolledBack` used to be `false` whenever the rollback request was refused, which is what happens when QCut has already ended the transaction and restored the timeline itself, so a script could not tell an intact timeline from a broken one. The apply now reads the timeline back and compares its whole contents with what it read before it started; `rolledBack` is the result, and `rollback` says how it is known (`by: "requested"`, `"timeout"` or `"none"`, with the transaction's state). When the transaction ran out, the error says so in front of the request that failed after it.
- `editor:timeline:apply` checks the whole manifest before it changes anything. A track colour the editor does not have (`"colorLabel": "cyan"`), an unknown track type, a clip with no length, a blend or fit mode that does not exist, and a 3D LUT of the wrong size were each found by the editor one request at a time, seconds into the write, and the timeline was then rolled back. A malformed entry in `updates` is found the same way, where it used to fail after a `--replace` had already cleared the timeline. They are now all listed at once, the error starts "The manifest has N problems; nothing was changed", and nothing is imported, opened or written.
- `editor:timeline:apply` imports a manifest's media 20 files at a time. A manifest that named more than 20 new files failed with `Batch size … exceeds maximum of 20`.
- A custom 3D LUT written without `domainMin` / `domainMax` no longer breaks the export. The write was accepted and `editor:export:start` then failed with `Cannot read properties of undefined (reading 'join')`. A cube without a domain is a 0..1 cube, as in a `.cube` file: it is stored with the default domain, and a cube already stored without one previews and exports as one. A cube whose `values` do not fill its `size` (`size³ × 3` numbers) is refused when it is written, by `element patch`, `element color`, a batch add and `timeline apply` alike, with the count it holds and the count it needs; an export that still meets one names the clip.
- A patch that names a LUT `cube` replaces the clip's cube. It used to be merged into the old one field by field, so new values could keep the old cube's domain.
- A project's "last modified" time follows its contents. Only a change to the project's own settings moved it, so a timeline edited all day, in the editor or with `editor:timeline:apply`, still showed the day before in the project list and in `editor:project:list`. It now moves when an edit to the timeline is saved and when a file is imported or removed. Opening a project does not move it.
- `editor:project:info` without `--project-id` describes the project the editor has open, as the timeline, track and element commands do; it answered `Missing --project-id`. Its result says whether the project is the open one (`isActive`).
- `editor:navigator:open --wait-ready` answers `readiness: { ready: true, opened: true }` with the time the navigation and the wait took together. It answered `opened: false` beside `navigated: true`, with the few milliseconds of the readiness check alone.
- `editor:element:patch` takes `blendMode` and `blendEnabled` on a clip; they were refused as "No supported field for a media element". The refusal of a patch the element cannot use lists the fields its type takes.

### Added

- `editor:element:color --lut-file <file>` puts a 3D LUT on one clip, several clips or every clip of a track: a `.cube` file, or a `.json` file holding the cube. `--lut-name` names it, `--lut-intensity` sets its strength, and `--lut-clear` removes the LUT and its data. Setting or removing a LUT this way takes a built-in preset off the clip, as the colour panel does: a preset is drawn in the LUT's place. A large cube is sent to fewer clips per request so the request stays inside the editor's limit. The fields `--set` takes, and the layout of a cube, are in the command's help.
- `editor:windows:focus` brings a QCut window in front of the other apps, restoring it when it is minimized or hidden (`--window-id` for a window other than the first). `POST /api/claude/windows/focus` does the same.

### Documentation

- The native-cli skill describes custom LUTs (the cube's layout, its default domain, what reads back), how a `timeline apply` fails and what `rolledBack` means, `project info` without an id, and `windows focus`.
