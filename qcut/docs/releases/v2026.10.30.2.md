---
version: "2026.10.30.2"
date: "2026-10-30"
channel: "stable"
---

# QCut v2026.10.30.2

### Added

- `editor updates pause` holds QCut's own updates back while a project is under way: nothing downloads by itself, and an update already downloaded does not install when QCut quits (on macOS, the install set up for the next quit is withdrawn). `editor updates resume` lets them go again and sets a downloaded update to install at the next quit; `editor updates status` says whether updates are paused and which version is on offer or downloaded. Settings → Updates has the same switch, and the update prompts stay quiet while paused. The pause lasts across launches until it is resumed.
- The first launch after an update opens the project that was open when QCut quit. Other launches open nothing by themselves, as before. The version that brings this first notes the open project when it quits, so the reopening starts with the update after it.
- An undo or redo answer counts elements that kept their place but not their settings (a replaced media, a trim, a grade) as `changed`, and names the `fields` that differ on a moved or changed element.

### Fixed

- Quitting QCut no longer leaves it running without a window, its editor API answering 401 and a downloaded update not installing, until a second quit. When the Beauty Lab cleanup on quit had nothing to wait for (QCut idle in the background), the quit it resumed was marked cancelled while the window still closed.
- An editor command QCut refuses (a replace-media whose media is too short or of the wrong kind, a delete that finds nothing, an add or update that cannot land) no longer adds an empty undo step or empties the redo stack.
- The editor's own Replace (a clip's context menu) no longer puts a sound in place of a picture clip, or a picture in place of a sound; video and stills still replace each other, as with `replace-media`. In both, a clip on an audio lane counts as a sound, so one split off with Separate Audio (it keeps the video's media) takes another sound.
- `editor:timeline:arrange` measures a speed-ramped clip at the project's frame rate. It measured it at 30 fps, so on other frame rates the next clip either landed on the ramp, and the arrange was refused, or left a gap.
- The Export dialog's FFmpeg export draws captions 28 px from the frame edge, where the preview and the native export draw them, instead of at `position.y` (90 px by default).
- Text shadows and glows blur as wide as in the preview: the Export dialog's FFmpeg export drew them about 70 % wider, and the native export's glow about 15 % narrower.
- The changelog page opens on the newest release. It compared only three parts of QCut's four-part versions and opened on 2026.10.29.1 while 2026.10.29.3 was out.
- The app's GitHub links and star count point at Quriosity-agent/qcut; the old address answered the star count with 0.
- Unit tests no longer write to QCut's own log (`~/Library/Logs/qcut/main.log`); their log lines stay on the console.
