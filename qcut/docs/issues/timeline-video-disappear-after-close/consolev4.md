 📍 Original source: media-store-display
blob-manager.ts:83   🔄 Requested by: VideoPlayer
blob-manager.ts:84   📊 Ref count: 2
video-player.tsx:187 [VideoPlayer] Using blob URL for 0d9c8747-4c26-a3e8-65a3-13859c652b4d: blob:app://./9ad3547a-5215-498f-aee9-ba107f741d0c
video-player.tsx:264 [VideoPlayer] ✅ Video loaded: 0d9c8747-4c26-a3e8-65a3-13859c652b4d
html2canvas.esm.js:5347 Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true. See: https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read-frequently
s.createCanvasClone @ html2canvas.esm.js:5347
html2canvas.esm.js:5347 Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true. See: https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read-frequently
s.createCanvasClone @ html2canvas.esm.js:5347
video-player.tsx:328 [VideoPlayer] ▶️ Video ready to play: 0d9c8747-4c26-a3e8-65a3-13859c652b4d
timeline-track.tsx:696 {"message":"Drop event started in timeline track","dataTransferTypes":["application/x-media-item"],"trackId":"4ebac1d4-e8a6-40e9-a941-4133adc23420","trackType":"media"}
timeline-track.tsx:938 [TimelineTrack] Processing media item drop: Object
timeline-track.tsx:947 [TimelineTrack] Found media item: Object
blob-manager.ts:365 [BlobManager] 🔒 Export lock acquired (count: 1)
use-export-progress.ts:93 🎬 EXPORT HOOK - Selecting engine type:
use-export-progress.ts:94   - isElectron(): true
use-export-progress.ts:95   - User selected engine: cli
use-export-progress.ts:101   ✅ Electron detected - letting factory auto-select FFmpeg CLI
export-engine-factory.ts:198 🏗️ EXPORT ENGINE CREATION - Starting engine creation:
export-engine-factory.ts:199   - Requested engine type: auto-select
export-engine-factory.ts:200   - Total duration: 11.161667000000001
export-engine-factory.ts:201   - Export settings: Object
export-engine-factory.ts:205   - No engine type specified, getting recommendation...
export-engine-factory.ts:90 🔍 EXPORT ENGINE DEBUG - Starting engine selection:
export-engine-factory.ts:91   - Force regular engine override: false
export-engine-factory.ts:554 🔍 DETAILED ELECTRON DETECTION:
export-engine-factory.ts:555   - window.electronAPI exists: true
export-engine-factory.ts:558   - electronAPI.ffmpeg exists: true
export-engine-factory.ts:560   - Available ffmpeg methods: Array(13)
export-engine-factory.ts:564   - exportVideoCLI type: function
export-engine-factory.ts:577 🔍 ENVIRONMENT CHECK: electronAPI exists: true, ffmpeg.exportVideoCLI: function
export-engine-factory.ts:580 🔍 ENVIRONMENT CHECK: isElectron result: true
export-engine-factory.ts:92   - Is Electron environment: true
export-engine-factory.ts:93   - Window.electronAPI exists: true
export-engine-factory.ts:97   - FFmpeg CLI available: true
export-engine-factory.ts:554 🔍 DETAILED ELECTRON DETECTION:
export-engine-factory.ts:555   - window.electronAPI exists: true
export-engine-factory.ts:558   - electronAPI.ffmpeg exists: true
export-engine-factory.ts:560   - Available ffmpeg methods: Array(13)
export-engine-factory.ts:564   - exportVideoCLI type: function
export-engine-factory.ts:577 🔍 ENVIRONMENT CHECK: electronAPI exists: true, ffmpeg.exportVideoCLI: function
export-engine-factory.ts:580 🔍 ENVIRONMENT CHECK: isElectron result: true
export-engine-factory.ts:115 🚀 EXPORT ENGINE SELECTION: CLI FFmpeg chosen for Electron environment
export-engine-factory.ts:118   - Reason: Native FFmpeg provides best performance
export-engine-factory.ts:119   - Expected performance: HIGH
export-engine-factory.ts:211   - Recommended engine: cli
export-engine-factory.ts:212   - Recommendation reason: Electron environment - using native CLI FFmpeg for best performance and stability
export-engine-factory.ts:215 🏗️ EXPORT ENGINE CREATION: Creating cli engine instance
export-engine-factory.ts:262 📌 CLI ENGINE SELECTED - Checking Electron availability...
export-engine-factory.ts:554 🔍 DETAILED ELECTRON DETECTION:
export-engine-factory.ts:555   - window.electronAPI exists: true
export-engine-factory.ts:558   - electronAPI.ffmpeg exists: true
export-engine-factory.ts:560   - Available ffmpeg methods: Array(13)
export-engine-factory.ts:564   - exportVideoCLI type: function
export-engine-factory.ts:577 🔍 ENVIRONMENT CHECK: electronAPI exists: true, ffmpeg.exportVideoCLI: function
export-engine-factory.ts:580 🔍 ENVIRONMENT CHECK: isElectron result: true
export-engine-factory.ts:267 ✅ Electron detected - Loading CLI FFmpeg engine
export-engine-factory.ts:268   - electronAPI available: true
export-engine-factory.ts:272   - ffmpeg.exportVideoCLI available: true
export-engine-factory.ts:280 🏗️ EXPORT ENGINE CREATION: Creating CLI engine with effects support
export-engine-factory.ts:284 ✅ CLI Export Engine module loaded successfully
export-engine-factory.ts:288 📦 Export: Effects store available: true
export-engine.ts:97 🎬 STANDARD EXPORT ENGINE: Constructor called
export-engine.ts:98 🎬 STANDARD EXPORT ENGINE: Will use MediaRecorder for export
export-engine-factory.ts:298 🚀 SUCCESS: CLI FFmpeg engine created and ready to use
export-analysis.ts:734 ✅ [EXPORT VALIDATION] Timeline configuration is valid
export-analysis.ts:442 🎯 [MODE DETECTION] Direct copy eligible - 2 video(s), checking requirements...
export-analysis.ts:448 🔍 [MODE DETECTION] Multiple sequential videos detected - checking properties for Mode 1 vs Mode 1.5...
export-analysis.ts:466 🔍 [MODE DETECTION] Using target: 1920x1080 @ 30fps (source: media-fallback)
export-analysis.ts:224 🔍 [MODE 1.5 DETECTION] Checking video properties...
export-analysis.ts:225 🔍 [MODE 1.5 DETECTION] Target: 1920x1080 @ 30fps
export-analysis.ts:241 ⚠️ [MODE 1.5 DETECTION] Video 0: No properties found - triggering normalization
export-analysis.ts:488 ⚡ [MODE DETECTION] Videos have different properties - using Mode 1.5: Video normalization (5-7x speedup)
export-analysis.ts:491 🎬 [MODE 1.5] Videos will be normalized to match export canvas before concatenation
export-analysis.ts:546 🔍 [EXPORT ANALYSIS] Video localPath validation: Object
export-analysis.ts:580 📊 [EXPORT ANALYSIS] Complete analysis result: Object
export-analysis.ts:610 🎬 [EXPORT ANALYSIS] Video elements with trim info: Array(2)
export-analysis.ts:626 ⚡ [EXPORT ANALYSIS] MODE 1.5: Using VIDEO NORMALIZATION - Fast export with padding! ⚡
effects-store.ts:838 🎨 EFFECTS STORE: No enabled effects for element af616a85-05c2-4e6a-972d-e591a4cf1063 - returning empty filter chain
effects-store.ts:838 🎨 EFFECTS STORE: No enabled effects for element 16058357-0cec-4c81-a0ab-21d1601f843e - returning empty filter chain
export-engine-cli.ts:1397 🔍 [TEXT EXPORT DEBUG] Starting text filter chain generation...
export-engine-cli.ts:1419 ℹ️ [TEXT EXPORT DEBUG] No text elements found in timeline
export-engine-cli.ts:1532 🚀 [FFMPEG EXPORT DEBUG] ============================================
export-engine-cli.ts:1535 🚀 [FFMPEG EXPORT DEBUG] Starting FFmpeg CLI export process
export-engine-cli.ts:1536 🚀 [FFMPEG EXPORT DEBUG] Export configuration:
export-engine-cli.ts:1537    - Session ID: 1764635248201
export-engine-cli.ts:1538    - Dimensions: 1920x1080
export-engine-cli.ts:1541    - FPS: 30
export-engine-cli.ts:1542    - Duration: 11.161667000000001s
export-engine-cli.ts:1543    - Quality: 1080p
export-engine-cli.ts:1544    - Audio files: 0
export-engine-cli.ts:1545    - Text elements: NO
export-engine-cli.ts:1548    - Sticker overlays: NO
export-engine-cli.ts:1551    - Direct copy mode: DISABLED
export-engine-cli.ts:1554    - Video sources: 2
export-engine-cli.ts:1565 🚀 [FFMPEG EXPORT DEBUG] ============================================
export-engine-cli.ts:1578 ⏳ [FFMPEG EXPORT DEBUG] Invoking FFmpeg CLI...
index.html:62 ❌ [EXPORT OPTIMIZATION] FFmpeg export FAILED! Error: Error invoking remote method 'export-video-cli': Error: Invalid export configuration. Expected Mode 1 (direct copy), Mode 1.5 (normalization), or Mode 2 (video with filters), but no valid export mode was selected. This may indicate an unsupported timeline configuration.
console.error @ index.html:62
index.html:62 ❌ [EXPORT OPTIMIZATION] Error message: Error invoking remote method 'export-video-cli': Error: Invalid export configuration. Expected Mode 1 (direct copy), Mode 1.5 (normalization), or Mode 2 (video with filters), but no valid export mode was selected. This may indicate an unsupported timeline configuration.
console.error @ index.html:62
index.html:62 ❌ [EXPORT OPTIMIZATION] Error details: Object
console.error @ index.html:62
blob-manager.ts:378 [BlobManager] 🔓 Export lock released (count: 0)