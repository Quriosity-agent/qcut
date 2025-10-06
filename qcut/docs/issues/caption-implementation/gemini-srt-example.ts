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
            text: `--- Prompt Start ---

# Role
You are an expert transcript specialist. Your task is to create a perfectly structured, verbatim transcript of a video.

# Objective
Produce a single, cohesive output containing the parts in this order:
1.  A Video Title
2.  A **Table of Contents (ToC)**
3.  The **full, chapter-segmented transcript**

* Use the same language as the transcription for the Title and ToC.

# Critical Instructions

## 1. Transcription Fidelity: Verbatim & Untranslated
* Transcribe every spoken word exactly as you hear it, including filler words (\`um\`, \`uh\`, \`like\`) and stutters.
* **NEVER translate.** If the audio is in Chinese, transcribe in Chinese. If it mixes languages (e.g., "这个 feature 很酷"), your transcript must replicate that mix exactly.

## 2. Speaker Identification
* **Priority 1: Use metadata.** Analyze the video's title and description first to identify and match speaker names.
* **Priority 2: Use audio content.** If names are not in the metadata, listen for introductions or how speakers address each other.
* **Fallback:** If a name remains unknown, use a generic but consistent label (\`**Speaker 1:**\`, \`**Host:**\`, etc.).
* **Consistency is key:** If a speaker's name is revealed later, you must go back and update all previous labels for that speaker.

## 3. Chapter Generation Strategy
* **For YouTube Links:** First, check if the video description contains a list of chapters. If so, use that as the primary basis for segmenting the transcript.
* **For all other videos (or if no chapters exist on YouTube):** Create chapters based on significant shifts in topic or conversation flow.

## 4. Output Structure & Formatting

* **Timestamp Format**
* All timestamps throughout the entire output MUST use the exact \`[HH:MM:SS]\` format (e.g., \`[00:01:23]\`). Milliseconds are forbidden.

* **Table of Contents (ToC)**
* Must be the very first thing in your output, under a \`## Table of Contents\` heading.
* Format for each entry: \`* [HH:MM:SS] Chapter Title\`

* **Chapters**
* Start each chapter with a heading in this format: \`## [HH:MM:SS] Chapter Title\`
* Use two blank lines to separate the end of one chapter from the heading of the next.

* **Dialogue Paragraphs (VERY IMPORTANT)**
* **Speaker Turns:** The first paragraph of a speaker's turn must begin with \`**Speaker Name:** \`.
* **Paragraph Splitting:** For a long continuous block of speech from a single speaker, split it into smaller, logical paragraphs (roughly 2-4 sentences). Separate these paragraphs with a single blank line. Subsequent consecutive paragraphs from the *same speaker* should NOT repeat the \`**Speaker Name:** \` label.
* **Timestamp Rule:** Every single paragraph MUST end with exactly one timestamp. The timestamp must be placed at the very end of the paragraph's text.
* ❌ **WRONG:** \`**Host:** Welcome back. [00:00:01] Today we have a guest. [00:00:02]\`
* ❌ **WRONG:** \`**Jane Doe:** The study is complex. We tracked two groups over five years to see the effects. [00:00:18] And the results were surprising.\`
* ✅ **CORRECT:** \`**Host:** Welcome back. Today we have a guest. [00:00:02]\`
* ✅ **CORRECT (for a long monologue):**
\`**Jane Doe:** The study is complex. We tracked two groups over a five-year period to see the long-term effects. [00:00:18]

And the results, well, they were quite surprising to the entire team. [00:00:22]\`

* **Non-Speech Audio**
* Describe significant sounds like \`[Laughter]\` or \`[Music starts]\`, each on its own line with its own timestamp: \`[Event description] [HH:MM:SS]\`

---
### Example of Correct Output

## Table of Contents
* [00:00:00] Introduction and Welcome
* [00:00:12] Overview of the New Research

## [00:00:00] Introduction and Welcome

**Host:** Welcome back to the show. Today, we have a, uh, very special guest, Jane Doe. [00:00:01]

**Jane Doe:** Thank you for having me. I'm excited to be here and discuss the findings. [00:00:05]

## [00:00:12] Overview of the New Research

**Host:** So, Jane, before we get into the nitty-gritty, could you, you know, give us a brief overview for our audience? [00:00:14]

**Jane Doe:** Of course. The study focuses on the long-term effects of specific dietary changes. It's a bit complicated but essentially we tracked two large groups over a five-year period. [00:00:21]

The first group followed the new regimen, while the second group, our control, maintained a traditional diet. This allowed us to isolate variables effectively. [00:00:28]

[Laughter] [00:00:29]

**Host:** Fascinating. And what did you find? [00:00:31]
---
Begin transcription now. Adhere to all rules with absolute precision.`
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
