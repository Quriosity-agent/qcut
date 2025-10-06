/**
 * Minimal Example: Generate SRT from Video using Gemini 2.5 Flash
 *
 * Prerequisites:
 * 1. Set environment variable: OPENROUTER_API_KEY=sk-or-v1-xxx
 * 2. Install dependencies: bun add @ffmpeg/ffmpeg @ffmpeg/util
 *
 * Run: bun run gemini-srt-example.ts
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Load .env file
const envPath = join(import.meta.dir, '.env');
try {
  const envContent = await readFile(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const [key, value] = line.split('=');
    if (key && value) {
      process.env[key.trim()] = value.trim();
    }
  }
} catch (error) {
  // .env file not found, will use existing env vars
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  console.error('❌ Error: OPENROUTER_API_KEY environment variable not set');
  process.exit(1);
}

async function extractAudioFromVideo(videoPath: string): Promise<Buffer> {
  console.log('📹 Extracting audio from video...');

  // For this minimal example, we'll use FFmpeg CLI
  // In production, use @ffmpeg/ffmpeg (WebAssembly) or child_process

  const { execSync } = await import('node:child_process');
  const { mkdtempSync, readFileSync, unlinkSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const tempDir = mkdtempSync(join(tmpdir(), 'qcut-audio-'));
  const audioPath = join(tempDir, 'audio.wav');

  try {
    execSync(`ffmpeg -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioPath}"`, {
      stdio: 'ignore'
    });

    const audioBuffer = readFileSync(audioPath);
    unlinkSync(audioPath);

    return audioBuffer;
  } catch (error) {
    throw new Error(`FFmpeg extraction failed: ${error.message}`);
  }
}

async function transcribeWithGemini(audioBuffer: Buffer, language = 'auto'): Promise<string> {
  console.log('🤖 Transcribing with Gemini 2.5 Flash...');

  const audioBase64 = audioBuffer.toString('base64');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://qcut.app',
      'X-Title': 'QCut Video Editor - Gemini SRT Example'
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Transcribe this audio into SRT subtitle format with precise timestamps.

Format requirements:
1. Number each subtitle block sequentially (1, 2, 3...)
2. Use timestamp format: HH:MM:SS,mmm --> HH:MM:SS,mmm
3. Each subtitle should be 1-2 sentences maximum
4. Add blank line between blocks
5. Language: ${language === 'auto' ? 'auto-detect' : language}

Example format:
1
00:00:00,000 --> 00:00:03,500
Hello, welcome to the video.

2
00:00:03,500 --> 00:00:07,200
Today we'll learn about captions.`
          },
          {
            type: 'audio_url',
            audio_url: {
              url: `data:audio/wav;base64,${audioBase64}`
            }
          }
        ]
      }],
      max_tokens: 8192,
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  return result.choices[0].message.content;
}

async function main() {
  const videoPath = join(import.meta.dir, 'video_template.mp4');
  const outputPath = join(import.meta.dir, 'output.srt');

  console.log('🎬 Starting SRT generation from video...\n');
  console.log(`Video: ${videoPath}`);
  console.log(`Output: ${outputPath}\n`);

  try {
    // Step 1: Extract audio from video
    const audioBuffer = await extractAudioFromVideo(videoPath);
    console.log(`✅ Audio extracted: ${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB\n`);

    // Step 2: Transcribe with Gemini
    const srtContent = await transcribeWithGemini(audioBuffer);
    console.log('✅ Transcription complete\n');

    // Step 3: Save SRT file
    await writeFile(outputPath, srtContent, 'utf-8');
    console.log(`✅ SRT file saved: ${outputPath}\n`);

    // Step 4: Display preview
    console.log('📄 SRT Preview (first 500 chars):');
    console.log('─'.repeat(50));
    console.log(srtContent.substring(0, 500));
    console.log('─'.repeat(50));
    console.log('\n✨ Done!');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
