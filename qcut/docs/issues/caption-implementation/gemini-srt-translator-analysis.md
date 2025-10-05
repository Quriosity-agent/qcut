# Gemini SRT Translator - Technical Analysis

**Repository:** https://github.com/MaKTaiL/gemini-srt-translator
**License:** MIT
**Language:** Python
**Primary Use:** AI-powered subtitle translation using Google Gemini

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Key Features](#key-features)
3. [Architecture & Design](#architecture--design)
4. [Technology Stack](#technology-stack)
5. [Core Implementation](#core-implementation)
6. [Translation Workflow](#translation-workflow)
7. [API Integration](#api-integration)
8. [Installation & Usage](#installation--usage)
9. [Relevance to QCut](#relevance-to-qcut)
10. [Integration Opportunities](#integration-opportunities)

---

## Project Overview

**Gemini SRT Translator** is a Python-based command-line tool and Python library that leverages Google's Gemini AI to translate subtitle (SRT) files across multiple languages while preserving timing and formatting.

### Problem It Solves

Traditional subtitle translation tools often:
- Lose context between subtitle lines
- Produce literal translations lacking natural flow
- Can't handle idiomatic expressions well
- Don't preserve cultural nuances

Gemini SRT Translator uses advanced AI to provide:
- **Context-aware translations** that understand narrative flow
- **Natural language output** that sounds native
- **Cultural adaptation** beyond literal word-for-word translation
- **Customizable translation strategies** for different content types

---

## Key Features

### 🌍 Translation Capabilities

| Feature | Description |
|---------|-------------|
| **Multi-language Support** | Translate to any language supported by Gemini AI |
| **Format Preservation** | Maintains original SRT timing and structure |
| **Resumable Translations** | Continue from interruption points |
| **Batch Processing** | Process subtitles in configurable batches (default: 300) |
| **Context Awareness** | Maintains narrative context across batches |

### 🎥 Video Integration

- **Direct Subtitle Extraction**: Extract SRT from video files (requires FFmpeg)
- **Audio Context**: Optionally include audio for improved translation accuracy
- **Video Format Support**: Works with common video formats via FFmpeg

### 🤖 AI Translation Features

| Feature | Description |
|---------|-------------|
| **Thinking Mode** | Uses Gemini's reasoning for nuanced translations |
| **Streaming Mode** | Real-time translation output |
| **Customizable Temperature** | Control translation creativity (0.0-2.0) |
| **Model Selection** | Choose from available Gemini models |
| **Safety Settings** | Configurable content filtering |

### 🔧 Developer Features

- **CLI Interface**: Command-line tool for automation
- **Python API**: Programmatic integration
- **Logging**: Detailed progress and error tracking
- **Interactive Mode**: User-friendly model selection
- **Version Checking**: Automatic update notifications

---

## Architecture & Design

### Component Diagram

```
┌─────────────────────────────────────────────────────────┐
│           Gemini SRT Translator Architecture            │
└─────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┴─────────────────┐
        │                                   │
┌───────▼────────┐                 ┌───────▼────────┐
│   CLI Layer    │                 │  Python API    │
│  (gst command) │                 │   (import)     │
└───────┬────────┘                 └───────┬────────┘
        │                                   │
        └─────────────────┬─────────────────┘
                          │
                ┌─────────▼──────────┐
                │ GeminiSRTTranslator│
                │      Class         │
                └─────────┬──────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
┌───────▼────────┐ ┌──────▼──────┐ ┌───────▼────────┐
│  SRT Parser    │ │ Gemini API  │ │ File Handler   │
│  (pysrt lib)   │ │ Integration │ │ (I/O + FFmpeg) │
└────────────────┘ └─────────────┘ └────────────────┘
```

### Class Structure

```python
class GeminiSRTTranslator:
    """Main translator class"""

    # Configuration
    gemini_api_key: str
    target_language: str
    input_file: str
    output_file: str

    # Advanced Settings
    model_name: str = "gemini-2.5-flash"
    batch_size: int = 300
    temperature: float = 1.0
    thinking: bool = False
    streaming: bool = False

    # Processing
    def translate(self) -> None
    def getmodels(self) -> list
    def _parse_srt(self) -> list
    def _translate_batch(self, batch) -> list
    def _handle_resumption(self) -> None
```

---

## Technology Stack

### Core Dependencies

```python
# Primary Dependencies
google-generativeai  # Gemini API integration
pysrt               # SRT file parsing
tqdm                # Progress bars
colorama            # Colored terminal output

# Optional Dependencies
ffmpeg-python       # Video/audio extraction
pydub              # Audio processing
```

### Python Version
- **Minimum:** Python 3.8+
- **Recommended:** Python 3.10+

---

## Core Implementation

### 1. SRT File Parsing

```python
import pysrt

# Load and parse SRT file
subtitles = pysrt.open('input.srt', encoding='utf-8')

# Access subtitle properties
for subtitle in subtitles:
    index = subtitle.index          # Sequential number
    start_time = subtitle.start     # Start timestamp
    end_time = subtitle.end         # End timestamp
    text = subtitle.text            # Subtitle text
```

**Key Features:**
- Handles multiple encodings (UTF-8, ISO-8859-1, etc.)
- Preserves timing information
- Maintains subtitle order
- Supports multiline text

### 2. Gemini API Integration

```python
import google.generativeai as genai

# Configure API
genai.configure(api_key=api_key)

# Create model instance
model = genai.GenerativeModel(
    model_name="gemini-2.5-flash",
    generation_config={
        "temperature": 1.0,
        "top_p": 0.95,
        "max_output_tokens": 8192,
    },
    safety_settings={
        "HARM_CATEGORY_HARASSMENT": "BLOCK_NONE",
        "HARM_CATEGORY_HATE_SPEECH": "BLOCK_NONE",
        # ... other safety settings
    }
)

# Generate translation
response = model.generate_content(
    prompt,
    stream=streaming_enabled
)
```

### 3. Batch Processing Strategy

The translator processes subtitles in batches to:
- **Maintain Context**: Consecutive subtitles provide narrative flow
- **Optimize API Calls**: Reduce overhead and cost
- **Handle Token Limits**: Stay within Gemini's token constraints

```python
# Batch processing pseudocode
batch_size = 300  # Configurable
total_batches = len(subtitles) // batch_size + 1

for batch_num in range(total_batches):
    start_idx = batch_num * batch_size
    end_idx = min(start_idx + batch_size, len(subtitles))

    # Extract batch
    batch = subtitles[start_idx:end_idx]

    # Build prompt with context
    prompt = build_translation_prompt(batch, context_from_previous)

    # Translate batch
    translated_batch = translate_via_gemini(prompt)

    # Update context for next batch
    context_from_previous = extract_context(translated_batch)

    # Save progress
    save_checkpoint(batch_num, translated_batch)
```

### 4. Translation Prompt Engineering

```python
def build_translation_prompt(batch, target_language, thinking=False):
    """
    Construct optimized prompt for Gemini
    """

    # Format subtitles for translation
    formatted_subtitles = "\n".join([
        f"{sub.index}\n{sub.start} --> {sub.end}\n{sub.text}\n"
        for sub in batch
    ])

    # Base prompt
    prompt = f"""
    Translate the following subtitles to {target_language}.
    Maintain the SRT format exactly as shown.
    Preserve timing information.
    Ensure natural, context-aware translations.

    Subtitles:
    {formatted_subtitles}
    """

    # Add thinking directive if enabled
    if thinking:
        prompt += """

        Before translating, think about:
        1. Overall context and narrative
        2. Character relationships and tone
        3. Cultural adaptations needed
        4. Idiomatic expressions
        """

    return prompt
```

### 5. Resumption & Error Handling

```python
class TranslationState:
    """Track translation progress for resumption"""

    def __init__(self, input_file):
        self.checkpoint_file = f"{input_file}.checkpoint"
        self.last_completed_batch = 0
        self.translated_subtitles = []

    def save_checkpoint(self, batch_num, translated_batch):
        """Save progress to file"""
        with open(self.checkpoint_file, 'w') as f:
            json.dump({
                'batch_num': batch_num,
                'translated': [sub.to_dict() for sub in self.translated_subtitles]
            }, f)

    def load_checkpoint(self):
        """Resume from saved progress"""
        if os.path.exists(self.checkpoint_file):
            with open(self.checkpoint_file, 'r') as f:
                data = json.load(f)
                self.last_completed_batch = data['batch_num']
                self.translated_subtitles = [
                    reconstruct_subtitle(sub_dict)
                    for sub_dict in data['translated']
                ]
            return True
        return False
```

### 6. Multi-API Key Support

```python
class APIKeyRotator:
    """Rotate through multiple API keys for quota management"""

    def __init__(self, api_keys: list):
        self.api_keys = api_keys
        self.current_index = 0

    def get_current_key(self):
        return self.api_keys[self.current_index]

    def rotate(self):
        """Switch to next API key"""
        self.current_index = (self.current_index + 1) % len(self.api_keys)
        return self.get_current_key()

    def handle_quota_error(self):
        """Automatically rotate on quota exhaustion"""
        if len(self.api_keys) > 1:
            new_key = self.rotate()
            print(f"Quota exceeded. Switching to next API key...")
            return True
        else:
            print("All API keys exhausted. Please try again later.")
            return False
```

---

## Translation Workflow

### Complete Process Flow

```
┌─────────────┐
│ Start       │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│ 1. Validate Inputs  │
│    - API key set?   │
│    - File exists?   │
│    - Language valid?│
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ 2. Check for Resume │
│    - Checkpoint?    │
│    - Load progress  │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ 3. Parse SRT File   │
│    - Read with pysrt│
│    - Extract entries│
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ 4. Initialize Model │
│    - Configure API  │
│    - Set parameters │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────────┐
│ 5. Process Batches      │
│    For each batch:      │
│    a. Build prompt      │
│    b. Call Gemini API   │
│    c. Parse response    │
│    d. Save checkpoint   │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────┐
│ 6. Write Output     │
│    - Combine batches│
│    - Save to file   │
└──────┬──────────────┘
       │
       ▼
┌─────────────┐
│ Complete    │
└─────────────┘
```

### Detailed Step Breakdown

#### Step 1: Input Validation

```python
def validate_inputs(self):
    """Validate all required inputs before processing"""

    # Check API key
    if not self.gemini_api_key:
        raise ValueError("Gemini API key not provided")

    # Check input file
    if not os.path.exists(self.input_file):
        raise FileNotFoundError(f"Input file not found: {self.input_file}")

    # Validate target language
    supported_languages = self.get_supported_languages()
    if self.target_language not in supported_languages:
        print(f"Warning: '{self.target_language}' may not be supported")

    # Check output path writable
    output_dir = os.path.dirname(self.output_file)
    if not os.access(output_dir, os.W_OK):
        raise PermissionError(f"Cannot write to: {output_dir}")
```

#### Step 2: Batch Translation with Context

```python
def translate_with_context(self, batches):
    """Translate batches while maintaining context"""

    previous_context = ""
    all_translated = []

    for i, batch in enumerate(batches):
        # Build prompt with previous context
        prompt = f"""
        Previous context: {previous_context}

        Translate these subtitles to {self.target_language}:
        {format_batch(batch)}
        """

        # Get translation
        response = self.model.generate_content(prompt)
        translated_batch = parse_gemini_response(response)

        # Update context (last 5 lines of this batch)
        previous_context = "\n".join([
            sub.text for sub in translated_batch[-5:]
        ])

        all_translated.extend(translated_batch)

    return all_translated
```

---

## API Integration

### Gemini API Configuration

```python
import google.generativeai as genai

class GeminiConfig:
    """Gemini API configuration"""

    # Available models (as of 2025)
    MODELS = [
        "gemini-2.5-flash",      # Fast, cost-effective
        "gemini-2.5-pro",        # High quality
        "gemini-1.5-flash",      # Previous generation
        "gemini-1.5-pro",        # Previous generation
    ]

    # Generation parameters
    GENERATION_CONFIG = {
        "temperature": 1.0,       # Creativity (0.0-2.0)
        "top_p": 0.95,           # Nucleus sampling
        "top_k": 40,             # Top-k sampling
        "max_output_tokens": 8192,
    }

    # Safety settings (permissive for subtitle content)
    SAFETY_SETTINGS = {
        "HARM_CATEGORY_HARASSMENT": "BLOCK_NONE",
        "HARM_CATEGORY_HATE_SPEECH": "BLOCK_NONE",
        "HARM_CATEGORY_SEXUALLY_EXPLICIT": "BLOCK_NONE",
        "HARM_CATEGORY_DANGEROUS_CONTENT": "BLOCK_NONE",
    }
```

### API Key Management

```python
# Priority order for API key
def get_api_key():
    """Get API key from multiple sources"""

    # 1. Environment variable
    api_key = os.getenv("GEMINI_API_KEY")
    if api_key:
        return api_key

    # 2. Config file
    config_file = os.path.expanduser("~/.gemini-srt-translator/config.json")
    if os.path.exists(config_file):
        with open(config_file) as f:
            config = json.load(f)
            if "api_key" in config:
                return config["api_key"]

    # 3. Interactive prompt
    api_key = input("Enter your Gemini API key: ").strip()

    # 4. Save for future use
    save_api_key(api_key)

    return api_key
```

### Rate Limiting & Quotas

```python
import time
from datetime import datetime, timedelta

class RateLimiter:
    """Handle API rate limits"""

    def __init__(self, requests_per_minute=60):
        self.requests_per_minute = requests_per_minute
        self.requests = []

    def wait_if_needed(self):
        """Wait if rate limit would be exceeded"""
        now = datetime.now()

        # Remove requests older than 1 minute
        self.requests = [
            req_time for req_time in self.requests
            if now - req_time < timedelta(minutes=1)
        ]

        # Check if at limit
        if len(self.requests) >= self.requests_per_minute:
            # Wait until oldest request expires
            oldest = min(self.requests)
            sleep_time = (oldest + timedelta(minutes=1) - now).total_seconds()
            if sleep_time > 0:
                print(f"Rate limit reached. Waiting {sleep_time:.0f}s...")
                time.sleep(sleep_time)

        # Record this request
        self.requests.append(now)
```

---

## Installation & Usage

### Installation

```bash
# Install via pip
pip install --upgrade gemini-srt-translator

# Or from source
git clone https://github.com/MaKTaiL/gemini-srt-translator.git
cd gemini-srt-translator
pip install -e .
```

### CLI Usage Examples

```bash
# Basic translation
gst translate -i subtitle.srt -l French

# Specify output file
gst translate -i input.srt -o output.srt -l Spanish

# Use specific model
gst translate -i input.srt -l German -m gemini-2.5-pro

# Enable thinking mode for better quality
gst translate -i input.srt -l Japanese --thinking

# Extract subtitles from video first
gst translate -v movie.mp4 -l Korean

# Include audio context for better accuracy
gst translate -v movie.mp4 -l Chinese --extract-audio

# Custom batch size
gst translate -i input.srt -l Russian -b 500

# List available models
gst models
```

### Python API Usage

```python
import gemini_srt_translator as gst

# Configure
gst.gemini_api_key = "your-api-key-here"
gst.target_language = "French"
gst.input_file = "subtitle.srt"
gst.output_file = "subtitle_fr.srt"

# Optional settings
gst.model_name = "gemini-2.5-flash"
gst.batch_size = 300
gst.thinking = True
gst.streaming = True
gst.temperature = 1.2

# Execute translation
gst.translate()

# List available models
models = gst.getmodels()
for model in models:
    print(model.name)
```

---

## Relevance to QCut

### Potential Integration Points

The Gemini SRT Translator offers several capabilities that could enhance QCut's caption system:

#### 1. **Caption Translation Feature**

QCut currently supports:
- ✅ AI transcription (speech-to-text)
- ✅ Multiple languages for transcription
- ✅ Caption export (SRT/VTT/ASS/TTML)
- ❌ **Missing:** Translation of existing captions

**Opportunity:** Add caption translation to complement transcription

#### 2. **AI Quality Improvements**

Gemini's advantages over traditional translation:
- **Context awareness** across subtitle sequences
- **Cultural adaptation** beyond literal translation
- **Tone preservation** for dialogue
- **Idiomatic expression** handling

#### 3. **Batch Processing Experience**

QCut can learn from Gemini SRT Translator's:
- **Resumable operations** with checkpoints
- **Progress tracking** for long operations
- **Batch optimization** strategies
- **Error recovery** patterns

---

## Integration Opportunities

### Scenario 1: Add Translation Tab to Caption Panel

```typescript
// QCut integration concept

interface CaptionTranslationRequest {
  sourceLanguage: string;
  targetLanguage: string;
  captionTrackId: string;
  model?: "gemini-2.5-flash" | "gemini-2.5-pro";
  temperature?: number;
  thinking?: boolean;
}

async function translateCaptions(
  request: CaptionTranslationRequest
): Promise<CaptionTrack> {
  // 1. Export current captions to SRT
  const srtContent = exportSrt(getCaptionSegments());

  // 2. Call Python bridge or API
  const translated = await callGeminiTranslation({
    content: srtContent,
    targetLanguage: request.targetLanguage,
    model: request.model
  });

  // 3. Parse translated SRT
  const segments = parseSrtToSegments(translated);

  // 4. Create new caption track
  return addCaptionTrack({
    name: `Captions (${request.targetLanguage})`,
    language: request.targetLanguage,
    segments,
    source: "translation"
  });
}
```

### Scenario 2: Electron IPC Integration

```typescript
// electron/gemini-translation-handler.ts

import { ipcMain } from "electron";
import { spawn } from "child_process";
import path from "path";

ipcMain.handle("translate-captions", async (event, options) => {
  const {
    srtContent,
    targetLanguage,
    apiKey,
    model = "gemini-2.5-flash"
  } = options;

  // Create temporary SRT file
  const tempDir = os.tmpdir();
  const inputFile = path.join(tempDir, `input_${Date.now()}.srt`);
  const outputFile = path.join(tempDir, `output_${Date.now()}.srt`);

  await fs.writeFile(inputFile, srtContent);

  // Call Python CLI
  return new Promise((resolve, reject) => {
    const python = spawn("gst", [
      "translate",
      "-i", inputFile,
      "-o", outputFile,
      "-l", targetLanguage,
      "-m", model,
      "-k", apiKey
    ]);

    python.on("close", async (code) => {
      if (code === 0) {
        const translated = await fs.readFile(outputFile, "utf-8");
        resolve(translated);
      } else {
        reject(new Error(`Translation failed with code ${code}`));
      }

      // Cleanup
      await fs.unlink(inputFile);
      await fs.unlink(outputFile);
    });
  });
});
```

### Scenario 3: Direct API Integration (No Python Dependency)

```typescript
// lib/caption-translation.ts

import type { TranscriptionSegment } from "@/types/captions";

interface GeminiTranslationConfig {
  apiKey: string;
  model?: string;
  temperature?: number;
  thinking?: boolean;
}

export async function translateCaptionsViaGemini(
  segments: TranscriptionSegment[],
  targetLanguage: string,
  config: GeminiTranslationConfig
): Promise<TranscriptionSegment[]> {

  // 1. Convert segments to SRT format
  const srtContent = segments.map((seg, idx) => `
${idx + 1}
${formatTime(seg.start)} --> ${formatTime(seg.end)}
${seg.text}
  `.trim()).join('\n\n');

  // 2. Build Gemini prompt
  const prompt = `
Translate the following subtitles to ${targetLanguage}.
Maintain the exact SRT format including timing.
Ensure translations are natural and context-aware.

${srtContent}
  `;

  // 3. Call Gemini API directly
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${config.model || 'gemini-2.5-flash'}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.apiKey
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: config.temperature || 1.0,
          maxOutputTokens: 8192
        }
      })
    }
  );

  const data = await response.json();
  const translatedSrt = data.candidates[0].content.parts[0].text;

  // 4. Parse back to segments
  return parseSrtToSegments(translatedSrt);
}
```

---

## Key Takeaways for QCut Development

### ✅ Best Practices to Adopt

1. **Batch Processing with Context**
   - Process captions in batches to maintain narrative flow
   - Keep context from previous batches for coherence
   - Implement checkpoint system for resumable operations

2. **Prompt Engineering**
   - Clear instructions for format preservation
   - Context about content type (dialogue, narration, etc.)
   - Cultural adaptation directives

3. **Error Handling**
   - Graceful degradation on API failures
   - Progress saving for long operations
   - User feedback during processing

4. **API Key Management**
   - Support multiple key sources (env, config, prompt)
   - Rotation for quota management
   - Secure storage practices

5. **User Experience**
   - Progress bars for long operations
   - Estimated time remaining
   - Clear error messages
   - Resumption capabilities

### 🔍 Technical Insights

1. **Gemini API is well-suited for subtitle translation**
   - Understands context across multiple lines
   - Preserves tone and cultural nuances
   - Can handle technical/specialized content

2. **SRT format is simple but robust**
   - Easy to parse and generate
   - Widely supported
   - Human-readable

3. **Python's ecosystem is strong for this use case**
   - `pysrt` for SRT parsing
   - `google-generativeai` for Gemini
   - Rich CLI libraries (click, typer)

### 💡 Feature Ideas for QCut

1. **Caption Translation Tab**
   - Translate existing caption tracks to other languages
   - Side-by-side comparison view
   - Batch translate multiple projects

2. **AI Caption Enhancement**
   - Improve existing captions for readability
   - Adjust reading speed/line breaks
   - Reformat for different audiences

3. **Multi-language Export**
   - Export video with multiple caption tracks
   - One transcription → many translations
   - Language selector in final export

---

## Comparison: QCut vs Gemini SRT Translator

| Feature | QCut Caption System | Gemini SRT Translator |
|---------|-------------------|---------------------|
| **Transcription** | ✅ Modal Whisper API | ❌ N/A |
| **Translation** | ❌ Not implemented | ✅ Gemini AI |
| **Timeline Integration** | ✅ Direct integration | ❌ Standalone |
| **Export Formats** | ✅ SRT/VTT/ASS/TTML | ✅ SRT only |
| **Video Integration** | ✅ Timeline-based | ✅ FFmpeg extraction |
| **Batch Processing** | ❌ Single file | ✅ Configurable batches |
| **Resumable Operations** | ❌ No checkpoints | ✅ Checkpoint system |
| **Context Awareness** | ✅ Timeline context | ✅ Narrative context |
| **Platform** | 🖥️ Electron desktop app | 🐍 Python CLI/library |

---

## Conclusion

The **Gemini SRT Translator** demonstrates a robust, production-ready approach to AI-powered subtitle translation. Its architecture, particularly around:

- **Batch processing with context preservation**
- **Resumable operations with checkpoints**
- **Multi-API key management**
- **Gemini API integration patterns**

...provides valuable patterns that could enhance QCut's caption system.

**Recommendation for QCut:**
Consider adding caption translation as a complementary feature to the existing transcription system, leveraging similar batch processing and context-aware translation strategies demonstrated by Gemini SRT Translator.

---

**Analysis Date:** 2025-10-05
**Analyzed By:** Claude Code
**Repository Version:** Latest (as of analysis date)
