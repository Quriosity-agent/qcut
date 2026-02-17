# AI Content Pipeline Submodule

This project vendors `video-agent-skill` as a git submodule at `packages/video-agent-skill`.

## Initialize the submodule

```bash
git submodule update --init --recursive
```

## Local development workflow

```bash
cd packages/video-agent-skill
pip install -e ".[dev]"
python -m pytest tests/ -x --tb=short
```

You can also run root-level convenience scripts:

```bash
bun run submodule:init
bun run aicp:install
bun run aicp:test
bun run aicp:list-models
```

## API key mapping

| QCut env var | video-agent-skill env var | Provider |
|---|---|---|
| `VITE_FAL_API_KEY` | `FAL_KEY` | FAL.ai |
| `GOOGLE_AI_API_KEY` | `GOOGLE_AI_API_KEY` | Google Veo/Imagen |
| `OPENAI_API_KEY` | `OPENAI_API_KEY` | OpenRouter/Sora |
| `ELEVENLABS_API_KEY` | `ELEVENLABS_API_KEY` | ElevenLabs TTS |
