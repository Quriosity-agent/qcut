🔍 ENVIRONMENT CHECK: electronAPI exists: true, ffmpeg.exportVideoCLI: function
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
effects-store.ts:838 🎨 EFFECTS STORE: No enabled effects for element 4a868f92-1411-4e2c-87a8-c85cbc415b28 - returning empty filter chain
effects-store.ts:838 🎨 EFFECTS STORE: No enabled effects for element 72b4c17f-a00a-402c-8c74-3af2642ba7e5 - returning empty filter chain
export-engine-cli.ts:1397 🔍 [TEXT EXPORT DEBUG] Starting text filter chain generation...
export-engine-cli.ts:1419 ℹ️ [TEXT EXPORT DEBUG] No text elements found in timeline
export-engine-cli.ts:1531 🚀 [FFMPEG EXPORT DEBUG] ============================================
export-engine-cli.ts:1534 🚀 [FFMPEG EXPORT DEBUG] Starting FFmpeg CLI export process
export-engine-cli.ts:1535 🚀 [FFMPEG EXPORT DEBUG] Export configuration:
export-engine-cli.ts:1536    - Session ID: 1764634890335
export-engine-cli.ts:1537    - Dimensions: 1920x1080
export-engine-cli.ts:1540    - FPS: 30
export-engine-cli.ts:1541    - Duration: 5.666666666666666s
export-engine-cli.ts:1542    - Quality: 1080p
export-engine-cli.ts:1543    - Audio files: 0
export-engine-cli.ts:1544    - Text elements: NO
export-engine-cli.ts:1547    - Sticker overlays: NO
export-engine-cli.ts:1550    - Direct copy mode: ENABLED
export-engine-cli.ts:1553    - Video sources: 2
export-engine-cli.ts:1564 🚀 [FFMPEG EXPORT DEBUG] ============================================
export-engine-cli.ts:1577 ⏳ [FFMPEG EXPORT DEBUG] Invoking FFmpeg CLI...
index.html:62 ❌ [EXPORT OPTIMIZATION] FFmpeg export FAILED! Error: Error invoking remote method 'export-video-cli': Error: Video 'AI-Video-ltxv2_fast_t2v-1764306813324-ltxv2_fast_t2v-1764306813363-a344f70a7bedc617.mp4' has trim values (trimStart=0s, trimEnd=2.986666666666667s). The concat demuxer doesn't support per-video trimming in multi-video mode. Please disable direct copy mode or pre-trim videos before export.
console.error @ index.html:62
index.html:62 ❌ [EXPORT OPTIMIZATION] Error message: Error invoking remote method 'export-video-cli': Error: Video 'AI-Video-ltxv2_fast_t2v-1764306813324-ltxv2_fast_t2v-1764306813363-a344f70a7bedc617.mp4' has trim values (trimStart=0s, trimEnd=2.986666666666667s). The concat demuxer doesn't support per-video trimming in multi-video mode. Please disable direct copy mode or pre-trim videos before export.
console.error @ index.html:62
index.html:62 ❌ [EXPORT OPTIMIZATION] Error details: Object
console.error @ index.html:62
blob-manager.ts:378 [BlobManager] 🔓 Export lock released (count: 0)