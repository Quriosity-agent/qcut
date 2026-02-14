# Session Notes — 2026-02-14

## What is the problem

The user needed to generate an AI image using the Nano Banana Pro model via the AI Content Pipeline (AICP) and upload it to the QCut editor's Media panel. Several blockers were encountered:

1. **AICP not installed** — The `aicp` CLI tool was not available on the system.
2. **Python version incompatibility** — The `video-ai-studio` package requires Python 3.10+, but the system default was Python 3.9.6.
3. **PEP 668 restriction** — Python 3.12 (installed via Homebrew) blocked `pip install` without `--break-system-packages` to protect the system environment.
4. **Missing FAL API key** — No `.env` file or `FAL_KEY` environment variable was configured, which is required to call the Nano Banana Pro model endpoint.
5. **Output directory mismatch** — The `--output-dir` flag was ignored by `aicp`, and the image was saved to a default `output/` folder instead of the specified path.

## How you fixed it

1. **Found Python 3.12** via Homebrew (`python3.12`) and installed the `aicp` package using `pip install --user --break-system-packages`.
2. **Created a `.env` file** in the project directory with the user-provided `FAL_KEY`.
3. **Generated the image** by running:
   ```bash
   aicp generate-image \
     --text "A cinematic golden hour portrait of a woman walking across the Brooklyn Bridge, dramatic lighting, photorealistic" \
     --model nano_banana_pro
   ```
   - Model: Nano Banana Pro
   - Cost: $0.002
   - Processing time: ~23 seconds
4. **Copied the output image** from `output/generated_image_1771045557.png` to `media/generated/images/` to follow the standard QCut project structure.
5. **Imported the image into QCut** via the REST API:
   ```bash
   curl -X POST -H 'Content-Type: application/json' \
     -d '{"source":"/path/to/generated_image_1771045557.png"}' \
     http://127.0.0.1:8765/api/claude/media/PROJECT_ID/import
   ```
   The image is now available in the Media panel with ID `media_Z2VuZXJhdGVkX2ltYWdlXzE3NzEwNDU1NTcucG5n`.
