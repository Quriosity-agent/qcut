/**
 * Native Gemini API Example: Generate Transcript from Video
 *
 * Prerequisites:
 * 1. Set environment variable: GEMINI_API_KEY=xxx
 * 2. Install: bun add @google/generative-ai
 *
 * Run: bun run gemini-native-api-example.ts
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GoogleGenerativeAI } from '@google/generative-ai';

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

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('❌ Error: GEMINI_API_KEY environment variable not set');
  console.error('Get your API key from: https://aistudio.google.com/app/apikey');
  process.exit(1);
}

async function extractAudioFromVideo(videoPath: string): Promise<Buffer> {
  console.log('📹 Extracting audio from video...');

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

async function transcribeWithGeminiNative(audioBuffer: Buffer): Promise<string> {
  console.log('🤖 Transcribing with Gemini 2.5 Pro (Native API)...');

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-pro',
  });

  const prompt = `--- Prompt Start ---

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
Begin transcription now. Adhere to all rules with absolute precision.`;

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        mimeType: 'audio/wav',
        data: audioBuffer.toString('base64')
      }
    }
  ]);

  const response = await result.response;
  return response.text();
}

async function main() {
  const videoPath = join(import.meta.dir, 'video_template.mp4');
  const outputPath = join(import.meta.dir, 'output-native.md');

  console.log('🎬 Starting transcript generation from video...\n');
  console.log(`Video: ${videoPath}`);
  console.log(`Output: ${outputPath}\n`);

  try {
    // Step 1: Extract audio from video
    const audioBuffer = await extractAudioFromVideo(videoPath);
    console.log(`✅ Audio extracted: ${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB\n`);

    // Step 2: Transcribe with native Gemini API
    const transcript = await transcribeWithGeminiNative(audioBuffer);
    console.log('✅ Transcription complete\n');

    // Step 3: Save transcript file
    await writeFile(outputPath, transcript, 'utf-8');
    console.log(`✅ Transcript saved: ${outputPath}\n`);

    // Step 4: Display preview
    console.log('📄 Transcript Preview (first 800 chars):');
    console.log('─'.repeat(50));
    console.log(transcript.substring(0, 800));
    console.log('─'.repeat(50));
    console.log('\n✨ Done!');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  }
}

main();
