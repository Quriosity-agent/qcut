---
version: "2026.10.18.3"
date: "2026-10-18"
channel: "stable"
---

# QCut v2026.10.18.3

### Improved
- Independent engine, smart body on video: a video clip with any of the ten smart body controls set now renders from the clip's own history instead of frame by frame as a photo. Body tracking, the face and the ten-part geometry carry from the clip's first frame, so the paused preview and the export show the same result, and seeking back or forward replays only the frames the engine lacks. The engine keeps a checkpoint every twelve frames in the project cache and resumes from it, so a restarted engine process or a second export reproduces the same bytes.
- The paused preview and the export decode a clip's frames the same way and share the frame cache: frames rendered while scrubbing are reused by the export, and an unchanged timeline exports from the cache alone.
- A tracked body is not disturbed by a second person entering the frame. A frame where the first detection sees several people, or where the person is lost, is shown as it is and tracking resumes on the next frame; a face kept through a re-detection is detected again instead of failing the clip.

### Fixed
- The independent engine's resident worker plans a clip's frames once instead of starting the planner for every frame.

### Verified
- A 1080×1920 clip in the app: the preview's four rendered frames were reused by the export unchanged (15 frames, exactly 15 cache entries); a second export matched the first frame for frame and took 3.6 s instead of 15.6 s; after killing the engine process and emptying the frame cache, a seek to frame 13 reproduced the exported pixels from the frame-12 checkpoint, and a seek to frame 5 replayed from the clip's start. Snapshot and restore are byte-identical on real footage, in one process and across two engine processes.
- 240 frames in one session: 0.6 s per frame in the engine (0.41 s in the body stage), memory 335→396 MB, twenty checkpoints, no failures. Composited scenes with two people on the first frame, a second person entering and a person leaving behave as described.

### Limitations
- Not real time: about 0.6 s per 1080p frame in the engine and about 1.4 s per frame in the app's export. Body intensity cannot be keyframed yet.
- An export at a different resolution than the project canvas starts its own history. A cut inside one clip is not detected: split the clip first. Clips that also use skin or face controls replay more slowly. The body and face networks are still the extracted ones.
