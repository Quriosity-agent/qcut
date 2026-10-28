# QCut 2701 trailer issue fixes (N6–N15)

Baseline: `v2026.10.27.1` / `51ffcee11`. Source: the 2026-10-28 StreetFighter
sample report (配乐、双语字幕、字卡, items N6–N15). The user's projects and the
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
- N16–N18, added to the report after this work started, are not part of it.

## Verification

Unit and integration tests (Vitest): see the PR for the list. Full suites on
the final tree: node project 8310 passed (3 load timeouts in
`capcut-e2e-gui-visual-bridge`, 12/12 alone), dom project 9926 passed
(2 load timeouts in `jianying-draft-export`, 22/22 alone).

Live E2E: `apps/web/src/test/e2e/editor-cli-trailer-2701.e2e.ts` replays the
report's sequence against an isolated build (temporary profile, free port,
**empty** credential folder) through the source CLI, then deletes its project.
Run on `bun run build` of this branch, offscreen: 1 passed (39.7 s with the
N13–N15 checks).

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
