# MCP Apps Guide

Reference implementation study from [mcp-apps-demo](https://github.com/donghaozhang/mcp-apps-demo). MCP Apps extend the Model Context Protocol to let tools return **interactive HTML UIs** rendered directly in Claude Desktop/Code, not just plain text.

## What Are MCP Apps?

Standard MCP tools return text. MCP Apps return text **plus** a `resource` content block with `mimeType: "text/html"`. The client renders this HTML in a sandboxed iframe inside the chat interface, creating rich interactive experiences.

```
Standard MCP Tool:  User → LLM → Tool → text response
MCP App:            User → LLM → Tool → text + HTML UI (rendered in iframe)
```

## Architecture

```
┌──────────────────────────────────────┐
│  Claude Desktop / Claude Code        │
│  ┌────────────────────────────────┐  │
│  │  Chat Interface                │  │
│  │  ┌──────────────────────────┐  │  │
│  │  │  Sandboxed iframe        │  │  │
│  │  │  (HTML from MCP tool)    │◄─┼──┼── @modelcontextprotocol/ext-apps
│  │  │                          │  │  │   enables bidirectional comms
│  │  └──────────────────────────┘  │  │
│  └────────────────────────────────┘  │
│           │ JSON-RPC 2.0 / stdio     │
└───────────┼──────────────────────────┘
            │
┌───────────▼──────────────────────────┐
│  MCP Server (Node.js)                │
│  @modelcontextprotocol/sdk           │
│  - Tools (return text + HTML)        │
│  - Resources (explicit HTML access)  │
└──────────────────────────────────────┘
```

## Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "latest",
    "@modelcontextprotocol/ext-apps": "latest"
  }
}
```

| Package | Where Used | Purpose |
|---------|-----------|---------|
| `@modelcontextprotocol/sdk` | Server-side (Node.js) | `McpServer`, `StdioServerTransport` |
| `@modelcontextprotocol/ext-apps` | Client-side (HTML via ESM CDN) | `App` class for iframe ↔ server comms |

## How to Build an MCP App

### 1. Create the Server

```javascript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "my-mcp-app",
  version: "1.0.0",
});
```

### 2. Define HTML as a String

```javascript
const myAppHtml = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: sans-serif; padding: 20px; }
  </style>
</head>
<body>
  <h1 id="title">My App</h1>
  <button id="action">Do Something</button>
  <div id="result"></div>

  <script type="module">
    import { App } from "https://esm.sh/@modelcontextprotocol/ext-apps";

    const app = new App({ name: "My App", version: "1.0.0" });

    try {
      await app.connect(); // Connect to parent MCP host
    } catch(e) {
      // Running standalone (no MCP host)
    }

    // Receive results from server tool calls
    app.ontoolresult = (result) => {
      const text = result.content?.find(c => c.type === "text")?.text;
      document.getElementById('result').textContent = text ?? 'No result';
    };

    // Call server tools from the UI
    document.getElementById('action').addEventListener('click', async () => {
      try {
        await app.callServerTool({ name: "my-tool", arguments: {} });
      } catch(e) {
        document.getElementById('result').textContent = 'Not connected';
      }
    });
  </script>
</body>
</html>`;
```

### 3. Register a Tool That Returns HTML

```javascript
const resourceUri = "ui://my-app/index.html";

server.tool(
  "my-tool",                    // Tool name (LLM selects this)
  "Description for the LLM",   // Helps LLM decide when to use it
  {},                           // Input schema (Zod-compatible)
  async () => ({
    content: [
      // Text for the LLM to reason about
      { type: "text", text: "Some data here" },
      // HTML UI rendered in iframe
      {
        type: "resource",
        resource: {
          uri: resourceUri,
          mimeType: "text/html",
          text: myAppHtml
        }
      }
    ],
  })
);
```

### 4. Optionally Register as a Resource

Resources can be accessed directly by the client without going through a tool call:

```javascript
server.resource(
  "my-app-ui",          // Resource name
  resourceUri,          // Must match the URI used in tool response
  { mimeType: "text/html" },
  async () => ({
    contents: [{ uri: resourceUri, mimeType: "text/html", text: myAppHtml }],
  })
);
```

### 5. Start the Server

```javascript
const transport = new StdioServerTransport();
await server.connect(transport);
```

## Content Types in Tool Responses

A tool response `content` array can contain multiple blocks:

```javascript
content: [
  // Text — consumed by the LLM for reasoning
  { type: "text", text: "structured data or summary" },

  // Resource — rendered as interactive UI in chat
  {
    type: "resource",
    resource: {
      uri: "ui://tool-name/page.html",   // ui:// prefix convention
      mimeType: "text/html",
      text: "<html>...</html>"
    }
  }
]
```

The client routes each block by type:
- `"text"` → displayed as text / fed to LLM
- `"resource"` with `text/html` → rendered in sandboxed iframe

## Bidirectional Communication

MCP Apps support **two-way** communication between the HTML UI and the server:

### Server → UI (Tool Results)

When the server returns a tool result, the HTML app receives it via callback:

```javascript
// In the HTML app
app.ontoolresult = (result) => {
  const text = result.content?.find(c => c.type === "text")?.text;
  // Update UI with server data
};
```

### UI → Server (Tool Calls)

The HTML app can call server tools interactively:

```javascript
// In the HTML app (triggered by user click, timer, etc.)
await app.callServerTool({
  name: "get-data",
  arguments: { query: "something" }
});
// Result arrives in ontoolresult callback
```

### Full Request Flow

```
User clicks button in iframe
  → app.callServerTool({ name, arguments })
  → MCP Client routes to server via JSON-RPC
  → Server tool handler executes
  → Response sent back via JSON-RPC
  → MCP Client forwards to iframe
  → app.ontoolresult fires with result
  → UI updates
```

## Connecting to Claude

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "my-mcp-app": {
      "command": "node",
      "args": ["/absolute/path/to/server.js"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add my-mcp-app node /absolute/path/to/server.js
```

## Key Patterns

### Graceful Degradation

Apps should work both with and without an MCP host:

```javascript
try {
  await app.connect();
} catch(e) {
  // Standalone mode — hide server-dependent features
}
```

### Self-Contained HTML

All CSS/JS is embedded inline — no external files, no build step:
- Inline `<style>` blocks
- Inline `<script type="module">` blocks
- CDN imports via `https://esm.sh/`
- No framework dependencies (vanilla JS)

### Resource URI Convention

Use `ui://` prefix to distinguish app resources from file URIs:

```
ui://tool-name/page.html
ui://dashboard/dashboard.html
ui://get-time/clock.html
```

### Input Parameters

Tools can accept parameters via a schema object:

```javascript
server.tool(
  "search",
  "Search for items",
  { query: { type: "string" }, limit: { type: "number" } },
  async ({ query, limit }) => ({
    content: [
      { type: "text", text: JSON.stringify(results) },
      { type: "resource", resource: { uri: "ui://search/results.html", mimeType: "text/html", text: buildResultsHtml(results) } }
    ]
  })
);
```

## Security

- HTML apps run in **sandboxed iframes** — no access to parent window, file system, or network
- Only communication channel is via `@modelcontextprotocol/ext-apps` API
- Server controls what tools/data the UI can access
- No global style leakage between apps

## Example: Demo Server Structure

The reference demo (`server.js`, 286 lines) contains:

| Lines | Component | Description |
|-------|-----------|-------------|
| 1-4 | Imports | MCP SDK + constants |
| 7-109 | Clock HTML | Self-updating clock with server time button |
| 112-221 | Dashboard HTML | Metrics cards + animated bar chart |
| 223-227 | Server init | `new McpServer()` |
| 234-244 | `get-time` tool | Returns ISO time + clock UI |
| 246-262 | `show-dashboard` tool | Returns JSON metrics + dashboard UI |
| 264-281 | Resource registration | Explicit access to both UIs |
| 283-286 | Server start | stdio transport + connect |

## Potential QCut Applications

MCP Apps could be used in QCut for:

- **Timeline preview** — render a mini timeline UI showing clip arrangement
- **Export progress** — interactive progress bar with cancel button
- **Color picker** — embedded color grading UI
- **Waveform viewer** — audio waveform visualization for selected clips
- **Media browser** — thumbnail grid for project media selection
- **FFmpeg status** — real-time encoding metrics dashboard
