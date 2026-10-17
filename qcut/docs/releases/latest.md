---
version: "2026.10.17.1"
date: "2026-10-17"
channel: "stable"
---

# QCut v2026.10.17.1

### Improved
- Smart shot split: `qcut editor timeline shot-split` finds a clip's cuts with the bundled local shot model (ONNX or FFmpeg scene detection when it is unavailable, `qcut editor analyze engines` says which), takes manual cut points, a minimum shot length and dry runs, and splits on the timeline as one undo step; the same split is in the clip's context menu. `qcut editor analyze shots` reports cut times.
- Colour: `qcut editor element color` sets the 15 basic controls on a clip or a whole track as one undo step, `qcut editor element filter --resource-id` applies a filter preset, and `element patch` accepts `color` and `adjustments`. Adjustment layers export through the native engine; layers with masks or multi-pass effects, clips with a filter stack, GL transitions and animated grades that use the tonal controls export through the editor engine automatically, and `--engine native` says why it is refused.
- Captions: `qcut editor captions import` puts an SRT, VTT or ASS file on captions tracks (overlapping cues get their own lane and stack upward in the preview and both exports; `--replace` swaps the old tracks in one transaction). Caption placement and stacking are the same in the preview, the editor export and the native export.
- Beats: `qcut editor beats mark` reads a clip's tempo and beats from the periodicity of its onsets (no threshold to tune), marks them in the editor's beat store and can bookmark the downbeats; `qcut editor timeline snap --to beats` moves clips onto the nearest beat (`--edge start|end|onset` — onset puts a sound effect's first attack on the beat — `--frame-align`, `--max-distance`, `--downbeats-only`, `--dry-run`), with visual clips landing on whole frames.
- Timeline round trip: `qcut editor timeline export` carries the mix (buses and master), each track's colour, mute, hidden, lock and audio settings, and `qcut editor timeline apply --replace --verify` restores all of it, trims included, in batches sized to the project (a 132-clip, 26-track project in one command). Ripple `delete-range` moves level and pan automation with the clips (`--keep-automation` leaves it).
- `qcut editor project duplicate` copies the media (into the copy's own folder), media folders, every scene's timeline, stickers and the mix, and names the copy "原名（副本）". `qcut editor track update --lock|--unlock|--hide|--unhide`; `add-element` text accepts `anchor` (e.g. `bottom-center`) instead of pixel offsets; transition refusals name the failing check.
- Text and captions render the same from both export engines: the native pass sizes each font to the preview's em, draws the glow as a blurred copy of the glyphs, honours letter spacing and the text box, and uses the preview's caption insets.

### Fixed
- Native export timing: timeline gaps are kept as black and silence, so text, stickers, adjustment layers and audio tracks after a gap stay where the timeline has them; the picture and sound start at zero (they ran 21–40 ms late after the concat, plus a third of a frame per text, sticker or adjustment pass); an untrimmed clip no longer loses its last frame; both engines end the file where the timeline ends (the editor engine cut its last frame to the remainder instead of adding a whole frame).
- Native colour grades match the preview: a static basic grade is rendered through a cube of the preview's own pixel maths, so shadows, highlights, whites, blacks, fade, saturation, vibrance and exposure come out as shown (FFmpeg's eq could not lift black and clipped above about +1.5 exposure).
- A trimmed clip restored by `timeline apply` kept its trims (the export's duration was trimmed already); `timeline apply` aborts before touching the mixer when the mix cannot be read; the master patch no longer tries to solo the master.
- Routes that change the open project refuse another project with 409 (batch cuts, shot split and the rest); a cut list is bound to its project; `project duplicate` rewrites media paths on Windows too.
- GL transitions were silently dropped on write and reported as added; a transition request without a numeric `duration` is refused with that reason.
- A range delete at a half-frame boundary left a zero-length sliver; a split clip keeps its transition on the half that still touches the next clip; the editor export creates its output folder first.

### Verified
- The drill film (212.25 s, 12 clips, 24 fps) exports natively with 5094 frames = the timeline, no frame gaps at the seams, cut points within 0.11 frame of the timeline and the picture starting at 0; the 26-track, 132-clip project round-trips through `timeline export` → `apply --replace --verify` with 0 field differences; text measured from both engines agrees within 4 px and the stacked captions sit at the same offsets; the trailer cue reads 142.4 BPM against a 144 BPM reference.

### Limitations
- Both export engines' files run up to two AAC frames (about 21–43 ms) longer than the timeline because sound is written in whole AAC frames; the picture ends on the timeline.
- Beat strength measures attacks, not loudness: a held note or a rest on a beat reads 0 even when it is loud.
- The shot model runs only where the local runtime is installed; elsewhere shot split uses ONNX or FFmpeg scene detection.
