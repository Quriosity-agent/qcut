Audio Mixing Options for QCut: Web Audio API vs. FFmpeg vs. Silent Track
Option A: Web Audio API Mixing (Recommended)

Description: This approach uses the browser’s Web Audio API to combine all audio tracks into a single mixed stream in real-time. The code snippet shows creating an AudioContext with a MediaStreamDestination node, then for each audio element (clip) on the timeline, loading it into an audio buffer source and connecting it to that destination. The canvas’s video stream (canvas.captureStream()) is then combined with the single mixed audio track from the audioDestination before recording via MediaRecorder. Essentially, Web Audio merges multiple audio inputs into one output stream that MediaRecorder can handle
stackoverflow.com
.

Pros:

In-browser mixing of multiple tracks: Solves the limitation of MediaRecorder only recording one audio track by merging all tracks into one. Using AudioContext.createMediaStreamDestination() and connecting multiple sources means MediaRecorder sees a single audio stream containing the mix
stackoverflow.com
stackoverflow.com
. This allows capturing a composite audio (e.g. background music + voiceover) alongside the canvas video.

Simplicity and integration: Implementing this in JavaScript is straightforward. It leverages standard Web APIs without extra dependencies. QCut’s timeline can play audio via Web Audio, and the same mixed output is recorded – WYSIWYG (what you hear during preview is what gets recorded). No need to manage external processes or file I/O – everything happens in the browser/Electron renderer.

Cross-platform (Web & Desktop): Because it uses browser APIs, this method works in the web app and in Electron. There’s no reliance on native modules or command-line tools. This unified approach is likely why the QCut project marked it as “Recommended.” It keeps the implementation consistent between running in a browser and the desktop app.

Cons:

Real-time export speed: Recording the canvas with audio in real-time means the export takes as long as the video’s duration. For example, exporting a 60-second video requires playing back the entire 60 seconds to capture it
stackoverflow.com
. This can be time-consuming for longer videos, since you can’t “fast-forward” the recording – the MediaRecorder must run at 1× speed.

Limited output format/control: The MediaRecorder API encodes to limited formats (typically WebM/Opus in Chrome). For instance, Chrome supports video/webm (Opus audio) but not more universally compatible formats like MP4/AAC
reddit.com
. This could require an extra conversion step if an MP4 output is needed for compatibility. Also, MediaRecorder doesn’t expose advanced encoding settings – you get whatever quality/bitrate the browser chooses. In contrast, FFmpeg would let you choose codecs and quality.

Potential performance impact: Because the app must render video frames and mix audio live, heavy projects could strain the CPU. Any lag in playback could affect the recording (e.g. dropped frames or slight A/V sync issues if the system can’t keep up). This is generally not a problem for short or simple edits, but it might be a limitation for very complex, high-resolution projects.

Option B: FFmpeg Command Line (Electron only)

Description: This approach offloads the mixing and encoding to FFmpeg (either the FFmpeg binary or a WebAssembly version, since QCut integrates FFmpeg
GitHub
). Instead of playing the video in real-time, the app would programmatically invoke FFmpeg with all the audio files and the video track as inputs. Using FFmpeg’s filters (such as the amix or amerge filter for audio), it can mix multiple audio tracks together and multiplex them with the video to produce a final file. This would likely be done in the Electron backend or via ffmpeg.wasm in the browser. QCut already includes “FFmpeg Integration – professional-grade video processing via WebAssembly”
GitHub
, so this option builds on that capability.

Pros:

Powerful and flexible processing: FFmpeg is an industry-standard tool for audio/video processing. It can handle virtually any codec and format. Using FFmpeg, you can directly merge audio tracks and video into a single output file with precise control. For example, one can use an FFmpeg filter graph to mix multiple audio inputs (e.g., using the amerge or amix filter to combine tracks) and output the result in a desired format
mux.com
. This means you can produce an MP4 with H.264 video and AAC audio (or any format needed) in one step, which is great for compatibility and quality. There’s no reliance on the browser’s limited encoding options.

Faster than real-time export: FFmpeg can encode faster than playback in many cases, since it’s not rendering to a canvas on screen. Especially on a powerful machine or using optimized settings, it might process a 60s video in a fraction of that time (depending on complexity). This allows offline rendering – the user doesn’t have to sit through the whole video playing out. The encoding runs as a background task and can potentially utilize multiple CPU cores.

Advanced audio control: With FFmpeg, you can do more than just mix all tracks at full volume. You could adjust volumes of each track, apply audio effects, normalization, etc., using FFmpeg’s audio filters. It’s more powerful if you need to, say, duck background music when dialogue comes in, or ensure no clipping. It’s essentially what professional editors use under the hood, so it offers maximum capability for future needs.

Cons:

Higher complexity in implementation: Setting up FFmpeg mixing requires generating the correct command or using an API to feed audio/video data. The timeline’s data (clips start/end times, etc.) must be translated into FFmpeg parameters (like constructing an -filter_complex for audio mix and sync). This is significantly more complex than the Web Audio approach. One developer noted that using ffmpeg.js would involve converting timeline data (images, etc.) into ffmpeg arguments and found it non-trivial
stackoverflow.com
. The same applies to audio tracks: you’d need to ensure each audio clip is placed at the right timestamp in the mix (which might involve preparing silent padding or using the adelay filter per track in FFmpeg). Writing and debugging these commands or code can be challenging.

Electron-only (limited web support): The option is noted as “Electron only” because running FFmpeg natively requires a desktop environment or using ffmpeg.wasm which is heavy. If QCut’s web version (in browser) is considered, using FFmpeg there would mean loading a large WebAssembly module and still possibly hitting performance limits. The WebAssembly version of FFmpeg works but can be slow for long videos or high-res output, and it increases memory usage. In contrast, the Web Audio approach works uniformly in a browser without additional binaries. So, adopting FFmpeg may lead to having two separate code paths: one for desktop (using native FFmpeg for speed) and one for web (perhaps falling back to Option A or not supporting export). This adds maintenance burden.

No real-time preview during export: Unlike the Web Audio approach where the video is playing (so the user could theoretically see/hear it while recording), the FFmpeg method would typically be a headless process – the user waits until it finishes to watch the result. (This isn’t a huge con, since it’s normal for exports to be non-real-time, but it’s a different workflow than capturing the live canvas.)

Option C: Silent Audio Track (Quick Fix)

Description: This is essentially a workaround rather than a true mixing solution. The idea is to add an empty audio track to the output so that the video file isn’t missing an audio stream. In practice, one can create a silent audio source and attach it to the MediaStream. For example, create an OscillatorNode in the AudioContext, connect it to a GainNode set to 0 gain (silence), and connect that into the audioDestination stream
stackoverflow.com
. This ensures the MediaStream has an audio track even if no real audio is present
stackoverflow.com
. The result is the exported video will contain an audio stream (silent) alongside the video.

Pros:

Prevents “no audio” technical issues: Some players or platforms expect an audio track in the video file. A common issue is that a video with no audio stream can cause playback or editing issues. By adding a silent track, you avoid errors where a file might be considered invalid or where certain browsers (or editors) refuse to handle a media stream with no audio. In Chrome specifically, there was a bug where a MediaRecorder on a stream with no initial audio track would fail; adding a silent track works around this Chrome bug so the recording proceeds properly
stackoverflow.com
. This option is a quick fix to ensure the output file always has an audio channel.

Simple to implement: Implementing a silent track is trivial compared to full mixing. As shown in the workaround, just a few lines of Web Audio code (oscillator → gain(0) → destination) will produce a silent audio track
stackoverflow.com
. No external libraries or heavy processing is needed. It’s basically a one-time setup and doesn’t consume much CPU (an oscillator at 0 gain is negligible overhead).

Cons:

No actual audio content: This approach does nothing for audible output. If your timeline had music or voice tracks, those will not be present in the exported video – effectively you’d get a video with silence. This defeats the purpose of a video editor for any case where audio is important. It’s only acceptable if you literally just needed to satisfy a file format requirement. In most scenarios, this isn’t a real solution, just a placeholder.

Not a scalable solution: Relying on a silent track might mask the problem (no proper audio mixing) without solving it. Users would be confused why their video has no sound. It doesn’t address mixing multiple tracks at all; it only ensures an audio stream exists. So this is truly a last-resort or interim hack (for example, if exporting audio was broken and you at least want a file to not error out). It would need to be replaced by a proper Option A or B implementation for a usable editor.

Recommendation

Considering the above, Option A (Web Audio API Mixing) is the most pragmatic choice for QCut’s needs at this time. It offers a good balance of ease-of-implementation and functionality. By using the Web Audio API to merge tracks, you get actual audio in the exported video with relatively little development effort, and it works in both the browser and Electron environments. In fact, this method is commonly used to record combined streams in web apps
stackoverflow.com
, and the snippet provided already demonstrates how to do it.

Option B (FFmpeg) is more powerful and will be beneficial in the long run for advanced export features – for example, faster renders and higher control over encoding. If QCut aims to provide professional-grade exports (e.g., direct MP4 output, multiple quality presets, etc.), integrating an FFmpeg-based pipeline is worthwhile. However, the complexity and maintenance cost of that approach are significantly higher. It might be something to implement once the basic functionality is in place. In the short term, sticking with the Web Audio API approach (Option A) gets the job done with minimal fuss, at the cost of real-time export speed. Many user-level editors are okay with waiting the duration of the video for export, especially if it’s handled seamlessly.

Option C (Silent track) is not recommended except as a temporary workaround for specific bugs. It doesn’t fulfill the actual requirement of including audio; it only prevents errors about missing audio. Using Option C alone would result in videos with no sound (aside from silence), which is not acceptable if the user added audio tracks in their project. Only use this technique in addition to Option A/B if you needed to guarantee an audio channel for technical reasons (for example, to avoid the Chrome issue where a MediaStream might not initialize an audio track without input – the snippet in Option C shows how to ensure the track is present
stackoverflow.com
).

In summary, Option A is the recommended approach for now because it’s straightforward and addresses the core need (multiple audio tracks mixed into the export) with minimal drawbacks. As the project matures, Option B (FFmpeg) can be explored for improved performance and flexibility, especially on the desktop app where its power can be fully utilized. Option C should only be seen as a supportive hack, not a standalone solution.

Sources:

Adam Marsh, Stack Overflow: Combining many audio tracks into one for MediaRecorder – using Web Audio API to merge streams
stackoverflow.com
stackoverflow.com

Owen Ovadoz, Stack Overflow: HTML Video exporting using MediaRecorder vs ffmpeg.js – notes real-time recording length equals video duration
stackoverflow.com
 and complexity of ffmpeg approach
stackoverflow.com

QCut Documentation (donghaozhang/qcut) – project features (multi-track support, FFmpeg integration)
GitHub

Mux Blog: Merge audio and video files with FFmpeg – example of using FFmpeg filters to combine audio tracks
mux.com

F. Guillen, Stack Overflow: MediaRecorder issue in Chrome (no audio source) – workaround by adding a silent oscillator track to ensure an audio channel
stackoverflow.com
stackoverflow.com

Reddit – MediaRecorder codec support: Chrome only outputs WebM/Opus which isn’t directly Safari-compatible
reddit.com