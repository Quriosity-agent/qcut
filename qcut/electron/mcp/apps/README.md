# MCP Apps

Interactive UI tools rendered in QCut's preview panel via iframe.

## Apps

| File | MCP Tool Name | Description |
|------|---------------|-------------|
| `configure-media.html` | `configure-media` | Aspect ratio, resolution, and duration picker |
| `export-settings.html` | `show-export-settings` | Export preset and quality selector |
| `project-stats.html` | `preview-project-stats` | Real-time project metrics dashboard |
| `wan-video.html` | `wan-reference-to-video` | Wan v2.6 reference-to-video generator via fal.ai |

## Wan v2.6 Reference-to-Video (`wan-video.html`)

Generates video from text prompts with reference images/videos using the [fal.ai Wan v2.6 Flash](https://fal.ai/models/wan/v2.6/reference-to-video/flash/api) model.

### Features

- **Prompt** with Character1/Character2 reference syntax for subject consistency
- **Reference images** (up to 5 URLs) and **reference videos** (up to 3 URLs)
- **Aspect ratio**: 16:9, 9:16, 1:1, 4:3, 3:4
- **Resolution**: 720p, 1080p
- **Duration**: 5s or 10s
- **Advanced options**: negative prompt, seed, prompt expansion, multi-shot segmentation, audio toggle
- **Queue-based generation** with progress polling against fal.ai queue API
- **Import to QCut** button to add generated video to the timeline

### API

- Model: `fal-ai/wan/v2.6/reference-to-video/flash`
- Queue endpoint: `https://queue.fal.run/fal-ai/wan/v2.6/reference-to-video/flash`
- Auth: `Authorization: Key <fal-api-key>` (entered in the UI)

### Test with curl

```bash
# Inject runtime config and send to preview panel
node -e "
const fs = require('fs');
const html = fs.readFileSync('electron/mcp/apps/wan-video.html', 'utf-8');
const injected = html.replace(/__QCUT_RUNTIME_CONFIG__/g, JSON.stringify({
  projectId: 'default',
  apiBaseUrl: 'http://127.0.0.1:8765',
  projectRoot: process.cwd()
}));
const payload = JSON.stringify({ toolName: 'wan-reference-to-video', html: injected });
const http = require('http');
const req = http.request({
  hostname: '127.0.0.1', port: 8765,
  path: '/api/claude/mcp/app', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
}, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>console.log(d)); });
req.write(payload); req.end();
"
```

## How It Works

1. MCP tool is called (via Claude or curl)
2. `qcut-mcp-server.ts` loads the HTML template and injects `__QCUT_RUNTIME_CONFIG__`
3. HTML is POSTed to `http://127.0.0.1:8765/api/claude/mcp/app`
4. `claude-http-server.ts` forwards via IPC `mcp:app-html` to the renderer
5. `preview-panel.tsx` renders the HTML in a sandboxed iframe
