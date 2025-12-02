🏗️ EXPORT ENGINE CREATION: Creating cli engine instance
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
effects-store.ts:838 🎨 EFFECTS STORE: No enabled effects for element 0bf1093d-ec86-48f2-8362-0384622aa23e - returning empty filter chain
effects-store.ts:838 🎨 EFFECTS STORE: No enabled effects for element d5777efb-0ba1-4564-b25e-510a0d7d52fb - returning empty filter chain
export-engine-cli.ts:1397 🔍 [TEXT EXPORT DEBUG] Starting text filter chain generation...
export-engine-cli.ts:1419 ℹ️ [TEXT EXPORT DEBUG] No text elements found in timeline
export-engine-cli.ts:1535 🚀 [FFMPEG EXPORT DEBUG] ============================================
export-engine-cli.ts:1538 🚀 [FFMPEG EXPORT DEBUG] Starting FFmpeg CLI export process
export-engine-cli.ts:1539 🚀 [FFMPEG EXPORT DEBUG] Export configuration:
export-engine-cli.ts:1540    - Session ID: 1764636925023
export-engine-cli.ts:1541    - Dimensions: 1920x1080
export-engine-cli.ts:1544    - FPS: 30
export-engine-cli.ts:1545    - Duration: 11.161667000000001s
export-engine-cli.ts:1546    - Quality: 1080p
export-engine-cli.ts:1547    - Audio files: 0
export-engine-cli.ts:1548    - Text elements: NO
export-engine-cli.ts:1551    - Sticker overlays: NO
export-engine-cli.ts:1554    - Direct copy mode: DISABLED
export-engine-cli.ts:1557    - Video sources: 2
export-engine-cli.ts:1568 🚀 [FFMPEG EXPORT DEBUG] ============================================
export-engine-cli.ts:1581 ⏳ [FFMPEG EXPORT DEBUG] Invoking FFmpeg CLI...
index.html:62 ❌ [EXPORT OPTIMIZATION] FFmpeg export FAILED! Error: Error invoking remote method 'export-video-cli': Error: Invalid export configuration. Expected Mode 1 (direct copy), Mode 1.5 (normalization), or Mode 2 (video with filters), but no valid export mode was selected. This may indicate an unsupported timeline configuration.
console.error @ index.html:62
index.html:62 ❌ [EXPORT OPTIMIZATION] Error message: Error invoking remote method 'export-video-cli': Error: Invalid export configuration. Expected Mode 1 (direct copy), Mode 1.5 (normalization), or Mode 2 (video with filters), but no valid export mode was selected. This may indicate an unsupported timeline configuration.
console.error @ index.html:62
index.html:62 ❌ [EXPORT OPTIMIZATION] Error details: Object
console.error @ index.html:62
blob-manager.ts:378 [BlobManager] 🔓 Export lock released (count: 0)