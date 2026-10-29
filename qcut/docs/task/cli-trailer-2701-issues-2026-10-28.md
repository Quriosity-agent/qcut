# QCut 2701 trailer issue fixes (N6–N20)

Baseline: `v2026.10.27.1` / `51ffcee11`. Source: the 2026-10-28 StreetFighter
sample report (配乐、双语字幕、字卡, items N6–N18, and N19–N20 from its
2026-10-29 addendum, after v16b and v17). The user's projects and the
installed app were not touched: every live check ran on an isolated build
(temporary profile, free API port, temporary state and credential folders)
with a throw-away project that the run deletes.

| Report | Root cause | Change |
| --- | --- | --- |
| N6: add-element to a deleted trackId answers ok and makes a new 「音频轨道」 | The single-add helpers fell back to find-or-create when the named track was missing or of another type (captions ignored `trackId` entirely). Every element removal also dropped **every** empty track, so an empty track made with `track:create` vanished at the next delete anywhere — the "delay" that swallowed a same-named new track. | A named `trackId` is the lane: missing → `Track not found: <id>` (with a hint), unsuitable → refused; the answer names `trackId`/`trackName`. Removals drop only the track they emptied. `delete-element` reports `trackRemoved` + a warning, 404s an unknown element and 409s a locked one; `batch-delete` lists `removedTrackIds`. Emptied tracks are still removed (the editor's own rule; smallest change). |
| N7: `captions import` fails with "Timeout waiting for transaction begin", then forever "Nested transactions … txn_…" | Main dropped its record when the editor's begin reply took > 5 s, but the editor still ran the queued begin later and kept the transaction with no timer (it never enforced `expiresAt`). Main also stayed "finalizing" forever when a commit/rollback reply timed out. | On a begin timeout main queues a **discard** behind the begin (nothing restored); a commit/rollback that times out re-arms the timeout; a new begin drops an editor transaction > 15 s past expiry; a rollback never restores into another project. New `editor transaction list\|status\|rollback` (rollback of an orphan discards it). |
| N8: caption style written at the top level or with text names is silently dropped; export shows no style | Captions read only `style.*` in subtitle names; other spellings and unknown fields vanished. `timeline export` does include `style` (since 2026-09-14) — it was absent because nothing had been stored. | One normalizer (`electron/types/caption-style-input.ts`) for add, batch-add, patch and `captions import --style`: text names (`color`, `strokeWidth`, `backgroundOpacity`, `shadowOffsetX/Y`, `verticalAlign`, `fontWeight`…) map to the caption's names, top-level style fields are accepted, and every unused field comes back as `warnings` / `ignoredFields`. Documented field table. |
| N9: `bold` Avenir Next exports Bold Italic | libass only had `/System/Library/Fonts/Supplemental` as fontsdir; Avenir Next (in `/System/Library/Fonts`) then came from the CoreText provider, which libass 0.17.4 matches `(Avenir Next, 700, 0)` → `AvenirNext-BoldItalic`. libass also reads every fontsdir file into memory (Supplemental: ~477 MB RSS per FFmpeg). | Each burn-in gets its own fontsdir of links to just the font files of the families its script names, found in `/System/Library/Fonts`, `…/Supplemental`, `/Library/Fonts`, `~/Library/Fonts` (native export, renderer FFmpeg export, paused composition preview, CLI subtitle burn): `AvenirNext-Bold`, ~53 MB. Off macOS, and when no family is installed, the old folder is kept. |
| N10: `--provider elevenlabs` goes through FAL, uses the E2E `test****-e2e` key and reports FAL's key format | The HTTP route only knew FAL BYOK. The placeholder came from an E2E run (2026-10-14 23:44) whose `apiKeys.set({falApiKey:"test-fal-api-key-e2e"})` wrote the user's real `~/.qcut/.env` **and** AICP `credentials.env`. | Scribe v2 route: `ELEVENLABS_API_KEY` → ElevenLabs directly; else the signed-in QCut account (license-server proxy, as the 字幕 panel); else a well-formed FAL key. Placeholders and FAL keys outside `key_id:key_secret` are skipped; the error names each option and what was skipped. `system keys` flags such keys. `QCUT_CREDENTIALS_HOME` moves both credential files; the E2E fixture now gives every test its own copy. New `transcribe start --to-captions` (+ `--style/--preset/--replace`). Spaces between Scribe words are kept in segments. |
| N11: bilingual captions need two tracks and a 1-frame offset; a two-line English cue is overlapped | Stacking counted one line per caption in all three engines; explicit `\n` was drawn only by the native pass (the preview collapsed it, the canvas export wrapped on spaces). | MVP: all three engines draw `\n`, and stacking lifts by one line box per line break. The same-start tie-break (upper track sits above) is documented as the bilingual recipe — no offset needed. A per-line secondary style and wrap-aware stacking are follow-ups. |
| N12.1: `export start --poll --json` prints two JSON documents | Not reproduced: since `db6367671` (2026-10-16, in 2026.10.27.1) the pending notice goes to stderr. | Verified live (stdout parses as one document). |
| N12.2: commands fail right after `navigator open` | In the packaged app :8765 is served by the utility process, whose `navigator/open` gave up after 10 s while the editor waits up to 20 s (main 25 s): a large project came back "timed out" while still loading. | The utility route uses the 25 s navigation budget; docs point to `--wait-ready`. |
| N12.3: a 电影字幕 preset | — | `film` preset for `captions import --preset` (no box, 1.5 px outline, soft shadow) and a 电影字幕 entry in the captions panel presets. |
| N13: `delete-element` answers ok, the `timeline export` right after still shows the element; deleting again "works" | Timeline reads carried no request id. A read that timed out while the editor was busy stayed queued there and was answered later, from the timeline as it was then; that late answer satisfied whichever read was waiting at the time — the export after the delete. The 2701 delete also answered `removed` without looking. | Each timeline read carries an id the editor echoes, and only the answer to that read is taken. `delete-element` answers once a read shows the element gone (`confirmed: true`, `trackElements`; up to 4 reads, ~20 s), `confirmed: false` with a warning when the editor never answered, 409 when it is still there. |
| N14: `track:move --index <main>` right after `track:create` answers ok but the track stays under main; the same command again works | Not reproduced in a fresh profile: since `60e1a6479` (in 2701) the move is applied and read back before it answers. The export it was checked against is the likeliest culprit (N13's stale read). | `track move --above/--below <trackId>` places a track next to another one in the editor's current order, with no index to work out; the answer has the resulting `index` and order. With N13's fix the export after a move reads the new order. |
| N15: right after `media:batch-import` of qtrle movs the 2nd `add-element` times out (~5 s) and is not placed; a few seconds later it works | `batch-import` only copied the files; the editor loaded them on the first add, and a single add waited only 5 s for the editor. In a large project that load and the work right after it outlast 5 s. (A fresh profile with 20 such movs did not time out: the first add, which loaded all 20, took 1.3 s.) | `batch-import` hands each copied file to the editor, as a single import with metadata does, and answers once the editor has it (`editorReady` per file; 20 s in all, then a warning while it keeps loading). `add-element` waits up to 25 s for a busy editor; on timeout it says the element may still be placed and to check `timeline export` before retrying. |

## N11 follow-up: a second-language line in one caption

The report's first wish for N11 (a 副语言行 with its own style) now exists, so
a bilingual caption is one element instead of two tracks:

- Data: `CaptionElement.secondaryText` and `SubtitleStyle.secondary`
  (`fontFamily`, `fontSize`, `fontColor`, `bold`, `italic`; anything left out
  is the caption's own; outline, shadow, box, line spacing and alignment
  are always the caption's). API and `timeline export` call the text
  `secondaryContent` (beside `content`); `secondaryText` is accepted too.
  The normalizer reads `style.secondary` in either spelling and names fields
  the second line cannot set (`style.secondary.outlineWidth` …).
- Engines: the preview draws the line as a second block in the same box; the
  canvas export lays both blocks out on the same line boxes (font size ×
  `lineSpacing`); the native export writes one ASS event — the second line
  after `\N` with inline font tags — and inserts spacer lines (a hard space
  at the missing height) so libass, which stacks lines exactly as tall as
  their ASS size with no leading, lands every line where the CSS box puts it.
  Stacking counts the block's real height in all three.
- libass measured, not assumed: lines are 52 px apart at ASS size 52 for
  Arial, Songti SC and Hiragino alike, i.e. the font's Windows height (the
  size factor), not its `hhea` height. Caption layout now uses that height;
  Songti SC had `hhea` 1.4 em against a Windows 1.0 em, which put a native
  Songti caption ~10 px below the canvas export's.
- I/O: add-element, batch-add, update-element (`""` removes the line; a
  partial `style.secondary` merges), `timeline apply` (passes it through),
  `captions import --secondary-file en.srt` (each cue goes to the `--file`
  cue it overlaps longest; unpaired ones are reported), SRT/VTT (second
  line), ASS (`\N`, which also fixes multi-line cues breaking the file),
  TTML (`<br/>`), the styled ASS export (inline font tags), and Jianying draft
  validation (accepts and checks the new fields).

Verified: unit tests for the normalizer, the patch path, batch add, the
snapshot, the preview, the canvas renderer, stacking, the ASS line
composition, the native overlay (font switch, bottom pin by the second
line's leading, stacking above a two-line block), the exports, the import
pairing and draft validation. `bilingual-caption-engine-parity.e2e.ts`
exports one bilingual caption (white Songti SC 52 bold over yellow Futura 30)
through both engines and measures each colour's pixels: text bottom 640 / 640,
second line bottom 682 / 678, gap 18 / 14 px (native / muxer); before the
line-height fix the text was 11 px apart. `text-caption-engine-parity`
still passes.

Not done: a karaoke caption draws only its first line in the preview and the
canvas export; the Jianying/CapCut draft export keeps only the first line;
there is no captions-panel editor for the second line yet (set it through
the API, the CLI or `captions import --secondary-file`).

## N16–N18: clip sound in the native export, replacing a clip, undo

| Report | Root cause | Change |
| --- | --- | --- |
| N16: a main-track clip's `volume`, `audio.enabled`, `audio.volumeDb` and `audio.keyframes.volumeDb` read back, but the native export came out sample for sample as before | The native export joins main-track clips segment by segment, and each segment took its sound straight from the source: no gain, mute, keyframes or fades. Clips the mix handles (audio tracks, overlays) got the legacy `volume` and fade fields only, so their volume keyframes and effects were dropped too. | Each joined segment's sound gets the clip's gain, mute, volume keyframes and fades, built by the mix's own envelope filter, on the timeline's clock (after the tempo change). Mixed clips get their full settings (effects, keyframes, fades), as in the muxer export. A main-track clip's other effects (EQ, denoise, pitch, compressor, reverb…) still come only from the muxer export; a native export that leaves them out lists those clips in its `warnings`. |
| N17: the docs say `batch-delete --cuts`, the command needs `--elements`; a batch delete without `--ripple` still moves every later main-track clip up; a single `add-element` ignores `"collision":"insert"` that `batch-add` honours | The flag's name changed without the docs, and the registry listed no flags. A batch delete without ripple called the store's ordinary removal, where the main-track magnet (QTL-005, on by default) closes every main-track gap. The single-add helpers never passed `collision` to the store. | `--cuts` is read as well as `--elements`, and the registry lists `--elements` and `--ripple`. An API batch delete without `--ripple` keeps every gap, whatever the editor's magnet and ripple settings (`removeElementFromTrack(…, { keepGap: true })`); deletes in the timeline are unchanged. Every single add passes `collision` to the store; an unknown value fails as in `batch-add`. The docs give the replace-in-place recipe. |
| N18: right after that delete, `editor:undo --force` answered ok, the main track stayed moved up, and two unrelated sound effects moved (106.3804→106.3964, 108.396→108.4); v14 moved them the same way with no undo at all: `batch-delete --elements` of five main-track clips, then `batch-add` with `"collision":"insert"` | The ripple removal (which the magnet uses) re-resolved overlaps on every track, so two effects that overlapped a neighbour by less than half a frame (a placement allows that) were pushed to its end: +16 and +4 ms, at the delete. v14 is the same delete: on 2701 a batch delete without `--ripple` went through the magnet's ripple removal, and an insert only ever changes its own track. The same strict pass also ran on every track in a ripple move (dragging with ripple mode on) and a ripple track removal (`track:delete --ripple`), and all three treated an overlap under half a frame, which a placement accepts, as one to resolve. And `editor:undo` printed ok whatever the editor answered, `applied: false` (nothing undone) included. Not reproduced: in a fresh project the undo after the same delete restores it every time. What the report saw fits an undo that changed nothing, e.g. under a transaction left in the editor by N7 (it suppresses the delete's history entry and makes the editor answer `applied: false`). | A ripple removal changes only the tracks it ripples and the deleted clip's own track. The ripple removal, a ripple move and a ripple track removal resolve overlaps by the placement rule (`resolveLaneOverlaps`): an overlap under half a frame counts as touching and stays where the ripple puts it. A ripple move changes only its own track, and a ripple track removal leaves a track it moves nothing on as it is. Undo and redo answer `label` (the step) and `changes` (elements added, removed and moved, the first ten with where they were), and fail when nothing changed: `Nothing to undo: the undo history is empty`, or `The editor did not undo: a transaction is open in it`. |

Verified: unit tests for the clip sound fields and the export warning
(`timeline-audio-file.test.ts`), the segment's filter chain with the real
FFmpeg (`export-segment-encode-real.test.ts`: the envelope after the tempo
change, a muted segment below RMS 1e-4), `keepGap` against the magnet and
ripple mode, the batch delete, a single add's `collision`, `--cuts`, the
ripple leaving other tracks alone, the change summary, the bridge's undo
answer and the CLI's undo/redo results. Two new E2Es on isolated builds:

- `main-track-clip-audio-export.e2e.ts`: two tone clips on the main track,
  the first with the report's keyframes (-60 dB to frame 45, 0 dB from 46),
  the second `{volume: 0, audio: {enabled: false, volumeDb: -60}}`, exported
  by both engines. RMS of the keyframed silence / after it / the disabled
  clip: native 0 / 0.088 / 0, muxer 0 / 0.125 / 0.
- `editor-cli-replace-clip.e2e.ts`: three 2 s clips and four effects that
  overlap in pairs by 12 and 4 ms (3, 3.488, 5, 5.496). `batch-delete --cuts`
  without `--ripple` leaves `[0, 4]`; the undo answers `{applied: true,
  label: "Edit", changes: {added: 1, removed: 0, moved: 0}}`; a `--ripple`
  delete leaves `[0, 2]` and every effect where it was; its undo lists the
  restored clip and the one moved back from 2 to 4; a single add into the
  occupied span is refused, `"collision":"squeeze"` is refused with batch-add's
  message, and `"collision":"insert"` gives `[0, 2, 4, 6]`; undoing until
  nothing is left fails with `Nothing to undo: the undo history is empty`.
  With the ripple fix taken out (rebuilt), the spec fails at the effects:
  3.488→3.5 and 5.496→5.5, the report's mechanism.
- The same spec's second test replays v14: eight 2 s clips and effects
  that overlap in pairs by 16 and 4 ms (1, 1.484, 3, 3.496).
  `batch-delete --elements` of the five middle clips without `--ripple`
  leaves `[0, 2, 14]` and every effect where it was; a `batch-add` with
  `"collision":"insert"` at 15 s gives `[0, 2, 14, 15, 17]`, the effects
  unchanged. Rebuilt with the 2701 delete (no `keepGap`, every track
  re-resolved), it fails right after the delete with the effects at
  `[1, 1.5, 3, 3.5]`: +16 and +4 ms, as in v13 and v14. On the final build
  both tests pass, with `main-track-cut-sync` and `timeline-daily-actions`
  (whose ripple deletes go through the same code): 7 passed (1.2 min).

Unit tests for the lane rule: `resolveLaneOverlaps` returns a lane whose
overlaps are all under half a frame as it is and moves a real overlap to
its neighbour's end (`timeline-occupancy.test.ts`); a touching overlap on
the rippled track, other tracks during a ripple move, and a ripple track
removal (`timeline-ripple-ops.test.ts`, 3 tests that fail on the previous
code). The whole web suite after it: 1597 files, 15461 tests passed
(104 skipped).

The muxer export's sound is about 3 dB above the native one's for the same
clip (0.125 against 0.088, the tone's own RMS); it was so before this change
and its cause was not looked into.

## N19–N20: the mix after a rename; inserts and ripples on a seam

Baseline `v2026.10.29.1` / `e48c726a5` (PR #526 merged). The record puts
both on the installed 2701, but only v16b's rename ran there: the app
restarted into 2026.10.29.1 at 13:42 local time, before the v17 work
(14:50–15:02). Both issues reproduced on this baseline first.

| Report | Root cause | Change |
| --- | --- | --- |
| N19: `mix:bus-automation` answered ok and `mix export` read the new master curve back, but the project file kept the old one; switching projects, `project:duplicate` and `project:rename` all gave the old curve (v16b, then the final v17 after its rename) | Every mixer command saves before it answers: on a fresh project the file holds each new curve, bus and level the moment the command returns, and v17's file had its new curve right after it was set (03:53 UTC). The old curve came back with `project:rename`. It saved the project list's copy of the record (`savedProjects`, last read when the project was duplicated, since a mix change does not re-read the list) and put that copy in the editor too, so the curve, buses and anything else changed since went back on disk and in the editor. The parent session's transcript and the app log place both losses at a rename: v16b's at its rename to 定版 (2026-10-29 02:15 UTC), v17's at 04:02 UTC (disk and live both back to the −60 dip the copy had). A duplicate and a reopen only showed what the rename had written. Moving a project to a folder worked the same way, and a duplicate of the open project read its record from disk, not from the editor. | A rename and a move to a folder change the open project as the editor holds it (the name or folder only, in the editor first, then saved) and a closed one as it is stored, read fresh rather than from the list (`stores/project-record-change.ts`). A duplicate of the open project copies the editor's record. Docs: every mixer change is saved before the command answers, and a rename changes only the name. |
| N20: on v17, `batch-delete --elements '[id]' --force` without `--ripple` left the gap, where v13–v15 closed it (N17), and the replacement put back with `"collision":"insert"` pushed the 30+ clips after it 1.29 s right; `timeline export` lists elements out of time order | The delete differs by version, not within one: v17 ran on 2026.10.29.1, where a batch delete without `--ripple` keeps its gap (N17's fix, as documented), and v13–v15 ran on 2701, where the magnet closed it. The fault is the insert: `insert` moved everything from its start on by the new clip's whole length, gap or not (as QTL-002 defined it), so the clip put back into its gap pushed every later clip 1.29 s right. Reproducing it showed a second fault on the same seam. 105_并肩_04 ran from 135.4584 for 1.2917 s, to 136.7501, and 106 started at 136.75, 0.1 ms earlier. A ripple delete (`--ripple`, or the magnet's single delete) moves the clips that start at or after the deleted clip's end, compared strictly, so 106 stayed, the clips rippled into it went back to their old places through the overlap pass, and the gap stayed open. Ripple moves, trims and track removals compared the same way. The export lists elements in the order they were added, so an inserted clip comes last. | `insert` moves the later clips only as far as the new one needs: its whole length where a clip starts at the point or is split there, less where a gap is, nothing where the gap fits it to within half a frame. Ripple deletes (the magnet's too), moves, trims and track removals count a clip starting less than half a frame before the edit point as after it (`startsAtOrAfter`, the seam rule placements use). `timeline export` lists each track's elements in time order. Docs: both rules, and that moves are checked one at a time (`batch-update` too), so clips going left move in time order and clips going right in reverse. |

Verified: unit tests for a rename of the open and of a closed project, a
move to a folder and a duplicate, each against a list copy older than the
project (`project-store-latest-record.test.ts`, 4 tests, all failing on the
previous code); ripples across v17's seam (a ripple delete, the magnet's
delete, a delete that keeps its gap, a ripple track removal, trim and move)
and inserts into a gap that fits, one 0.1 ms short, one too short, v17's own
numbers, at a clip start and inside a clip (`timeline-ripple-seams.test.ts`,
`timeline-insert-room.test.ts`: 9 of the 12 fail on the previous code, the
other 3 are behaviour that stays); the export's time order
(`claude-media-timing.test.ts`). Two E2E specs on isolated builds:

- `editor-cli-mix-save.e2e.ts`: bus-create, bus-set, master-set,
  bus-automation, and a bus created and removed: after each command the
  project file holds the new mix. A track's level, bus, pan curve and mute
  read back through `mix export`. A rename keeps all of it in the file and
  the editor; a duplicate's file has the same mix; after a further master
  change, a rename of the closed project keeps it, and reopening the project
  shows everything as it was left. On the build without the fix the spec
  fails at the first rename: the file is back to the new project's mix.
- `editor-cli-replace-clip.e2e.ts`, third test: 24 fps, five 1.2917 s clips on
  the main track with two seams where a clip ends 0.1 ms after the next one
  starts. A batch delete of 105 by plain id without `--ripple` keeps the gap;
  the replacement put back with `insert` moves nothing and is second in the
  export; a `--ripple` delete of 107 and the magnet's single delete of the
  replacement close their gaps; the effects track stays as it was. On the
  build without the fix it fails at the insert, as v17 did: the three later
  clips 1.2917 s right and the inserted clip listed last.

The whole web suite: 1600 files, 15478 tests passed (104 skipped); check-types,
lint and the build pass. E2E on the final build: 26 of 28 passed across both
specs, `project-duplicate`, `file-operations-storage-management`,
`timeline-context-menu`, `main-track-cut-sync` and `timeline-daily-actions`;
`timeline-apply-roundtrip` (skipped there for want of its local clip) passed on
its own with a generated clip (1 passed). The one failure,
`timeline-context-menu` › smart shot split, expects the menu to send
`threshold: 0.3`, which the shared shot split stopped doing in PR #505; it and
its code are unchanged here.

## Not changed

- WZRD (QCut Web) Scribe v2 through the user's WZRD account: a different
  account system and repository (`Quriosity-agent/wzrdagentstudio-qcut`).
  Proposed design: QCut desktop signs in to WZRD (OAuth device flow), and the
  Scribe route gains a fourth option that calls the WZRD Audio node API with
  `elevenlabs-scribe-v2`, billed to the WZRD balance. Not implemented here.
- The user's `~/.qcut/.env` and `~/.config/video-ai-studio/credentials.env`
  still hold `FAL_KEY=test****-e2e`; `~/.qcut/.env.before-falfix-20260907-212236`
  and `credentials.env.bak` are older copies. Restoring a real key is the
  user's call.
- Captions still default to an 80 % black box (changing the default would
  change existing projects); use `--preset film` or `bgOpacity: 0`.
- Automatic wrapping is not counted for stacking (the engines measure text
  differently); break long cues with `\n`.
- The canvas export still wraps captions only at spaces, so a long CJK line
  without breaks does not wrap there (pre-existing).
- The project check every editing command makes first still waits 5 s for the
  editor: a command that lands in a longer busy stretch fails with `No active
  editor project could be confirmed` (nothing is changed, so it can simply be
  retried; the report's scripts already do).
- A single `media:import` still tells the editor without waiting for it (it
  already loads right away); only `batch-import` used to skip the editor.
- N16: a main-track clip's audio effects other than gain, mute, keyframes and
  fades are still applied only by the muxer export (the native export lists
  the clips it leaves them out of). Moving every main-track clip's sound
  into the mix would change the export's audio path for every project.
- N17: no command replaces a clip's source in place yet; the recipe is
  `batch-delete` without `--ripple`, then `add-element` at the same start.
- N18: history steps other than transactions are still labelled `Edit`;
  `changes` is what tells them apart.
- N19: the project store's other record changes (bookmarks, frame rate,
  canvas, guides, the timeline toggles) save the record as it was when they
  started and put it in the editor once saved, so a change landing in
  between could be lost. Nothing in the report went that way.
- N20: `batch-update` still applies its moves one at a time, so a batch that
  moves many clips by the same amount must be in order (documented) rather
  than checked as a whole. `rippleDeleteAcrossTracks` (no caller) and the
  unused `element-operations.ts` keep the strict comparison.

## Verification

Unit and integration tests (Vitest): see the PR for the list. Full suites on
the final tree: node project 8310 passed (3 load timeouts in
`capcut-e2e-gui-visual-bridge`, 12/12 alone), dom project 9926 passed
(2 load timeouts in `jianying-draft-export`, 22/22 alone).

Live E2E: `apps/web/src/test/e2e/editor-cli-trailer-2701.e2e.ts` replays the
report's sequence against an isolated build (temporary profile, free port,
**empty** credential folder) through the source CLI, then deletes its project.
Run on `bun run build` of this branch, offscreen: 1 passed (39.7 s with the
N13–N15 checks). On the final tree it ran again with the two N16–N18 specs
and `bilingual-caption-engine-parity`: 4 passed (1.5 min).

| Check | Result |
| --- | --- |
| N6 delete the only element of 「配乐 1」 | `trackRemoved: true` + warning naming 「配乐 1」; the unfilled 「配乐 Suno」 made before it is still there |
| N6 add-element to the removed track id | fails: `Track not found: <id>. It may have been deleted …`; no track was made |
| N8 batch-add with `color`, `strokeWidth`, `backgroundOpacity`, `style.marginV` | stored `{fontFamily:"Futura", fontColor:"#ECE8DE", outlineWidth:1.6, bgOpacity:0, position:{align:"bottom"}}`, read back by `timeline export`; one warning for `style.marginV` |
| N7 `captions import` while the editor's main thread is held for 8 s | fails: `Timeout waiting for transaction begin: … Nothing was changed; retry once it is ready.`; `transaction list` → `editor: {activeTransaction: null, orphaned: false}`; the next import adds its cue |
| N9 native export of `bold` Avenir Next "IIIIII" at 160 px | stroke slant 0.0000 px/px (the same metric on libass with the old Supplemental-only fontsdir: 0.1762, i.e. Bold Italic) |
| N12.1 `export start --poll --json` | stdout is one JSON document (1178 bytes); the pending notice is on stderr |
| N10 `transcribe start --provider elevenlabs` with only `FAL_KEY=test-fal-api-key-e2e` | fails before any request: `ElevenLabs transcription has no usable credentials. It needs one of: ELEVENLABS_API_KEY …, a signed-in QCut account …, or a FAL key in key_id:key_secret form …. Skipped: FAL_KEY looks like a test placeholder` |
| N10 `check-keys` | `FAL_KEY` reported with `warning: "looks like a test placeholder …"` |
| N13 `timeline export` while the editor's main thread is held 9 s, then `delete-element` | the export fails; the delete answers `{removed: true, confirmed: true, trackElements: 1}` once the editor is free; the export right after does not list the element |
| N14 `track create --type media`, then `track move --above <main>` | answer `index` 2 = the track's index in the export, main at 3 |
| N15 `batch-import` of 3 qtrle ARGB cards (1470×630), then `add-element` each at once | every file `editorReady: true` and already in the editor's media list when the import answered; the 3 adds exit 0 |

N9 was first reproduced with the bundled FFmpeg (libass 0.17.4, CoreText
provider): `fontselect: (Avenir Next, 700, 0) -> /System/Library/Fonts/Avenir
Next.ttc, -1, AvenirNext-BoldItalic`; with the per-export folder:
`-> AvenirNext-Bold, 0, AvenirNext-Bold`. Peak RSS of that FFmpeg: 477 MB with
fontsdir=Supplemental, 1.1 GB with /System/Library/Fonts, 53 MB with the
per-export folder.

N7, N12.2 and the transaction edge cases are also covered without a window:
`claude-transaction-recovery.test.ts` drives the main-process handler against
a scripted editor that handles messages in order once free (each of its
three fix paths fails with the fix removed), and
`utility-navigator-open.test.ts` starts the real utility HTTP server with a
project that takes 11 s to load (504 at 10 s before).

N13–N15 without a window: `timeline-request-correlation.test.ts` replays the
race (a read times out in a busy editor, the element is deleted, a new read
is made; the editor answers the old read first) and the new read gets the
post-delete timeline; the HTTP suite pins the delete's confirmation reads,
the 504 of an unconfirmed placement and `batch-import` asking the editor for
each copied file; `claude-renderer-mutation-handler.test.ts` places a clip the
editor confirms after 8 s (5 s failed before); `claude-track-move-relative`
and `editor-track-move-cli` cover `--above/--below`.
