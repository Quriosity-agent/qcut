# Gemini SRT Generation Example

Minimal example demonstrating how to generate SRT subtitles from a video using Gemini 2.5 Flash via OpenRouter.

## Prerequisites

1. **FFmpeg installed** (must be in PATH)
   ```bash
   # Windows (via Chocolatey)
   choco install ffmpeg

   # Or download from: https://ffmpeg.org/download.html
   ```

2. **OpenRouter API Key**
   - Sign up at: https://openrouter.ai/
   - Get API key from dashboard
   - Set environment variable:
     ```bash
     # Windows (PowerShell)
     $env:OPENROUTER_API_KEY="sk-or-v1-xxx"

     # Windows (CMD)
     set OPENROUTER_API_KEY=sk-or-v1-xxx

     # Linux/Mac
     export OPENROUTER_API_KEY=sk-or-v1-xxx
     ```

## Usage

```bash
# Navigate to this directory
cd qcut/docs/issues/caption-implementation

# Run the example
bun run gemini-srt-example.ts
```

## What It Does

1. **Extracts audio** from `video_template.mp4` using FFmpeg
2. **Converts to WAV** (16kHz, mono, PCM)
3. **Base64 encodes** the audio
4. **Sends to Gemini 2.5 Flash** via OpenRouter API
5. **Parses SRT response** from Gemini
6. **Saves to** `output.srt`

## Expected Output

```
🎬 Starting SRT generation from video...

Video: C:\Users\...\video_template.mp4
Output: C:\Users\...\output.srt

📹 Extracting audio from video...
✅ Audio extracted: 1.23 MB

🤖 Transcribing with Gemini 2.5 Flash...
✅ Transcription complete

✅ SRT file saved: C:\Users\...\output.srt

📄 SRT Preview (first 500 chars):
──────────────────────────────────────────────────
1
00:00:00,000 --> 00:00:03,500
Hello, welcome to QCut video editor.

2
00:00:03,500 --> 00:00:07,200
Today we'll learn about caption features.
──────────────────────────────────────────────────

✨ Done!
```

## Cost Estimate

- **Audio input**: ~$0.01 per 10 minutes (based on $0.30/M tokens)
- **SRT output**: ~$0.05 per file (based on $2.50/M tokens)
- **Total for 10min video**: ~$0.06

## Files Generated

- `output.srt` - Generated SRT subtitle file

## Troubleshooting

### Error: FFmpeg not found
- Install FFmpeg and add to PATH
- Verify with: `ffmpeg -version`

### Error: OPENROUTER_API_KEY not set
- Set the environment variable before running
- Check with: `echo $env:OPENROUTER_API_KEY` (PowerShell)

### Error: Gemini API error 401
- Invalid API key
- Get new key from https://openrouter.ai/keys

### Error: Gemini API error 429
- Rate limit exceeded
- Wait a few minutes and try again
- Check your OpenRouter credits

## Integration with QCut

This example demonstrates the core logic that would be integrated into QCut's caption system:

1. **Replace**: `electron/transcribe-handler.ts` with Gemini implementation
2. **Remove**: R2 upload, encryption, Modal API calls
3. **Simplify**: Direct audio → Gemini → SRT workflow

See `caption-system-architecture.md` for full implementation details.
