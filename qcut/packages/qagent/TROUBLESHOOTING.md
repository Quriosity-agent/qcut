# Troubleshooting

## DirectTerminal: posix_spawnp failed error

**Symptom**: Terminal in browser shows "Connected" but blank. WebSocket logs show:

```
[DirectTerminal] Failed to spawn PTY: Error: posix_spawnp failed.
```

**Root Cause**: node-pty prebuilt binaries are incompatible with your system.

**Fix**: Rebuild node-pty from source:

```bash
# From the repository root
cd node_modules/node-pty
npx node-gyp rebuild
```

**Verification**:

```bash
# Test node-pty works
node -e "const pty = require('./node_modules/node-pty'); \
  const shell = pty.spawn('/bin/zsh', [], {name: 'xterm-256color', cols: 80, rows: 24, \
  cwd: process.env.HOME, env: process.env}); \
  shell.onData((d) => console.log('✅ OK')); \
  setTimeout(() => process.exit(0), 1000);"
```

**When this happens**:

- After `bun install` (uses cached prebuilts)
- After copying the repo to a new location
- On some macOS configurations with Homebrew Node

**Permanent fix**: The postinstall hook automatically rebuilds node-pty:

```bash
bun install  # Automatically rebuilds node-pty via postinstall hook
```

If you need to manually rebuild:

```bash
cd node_modules/node-pty
npx node-gyp rebuild
```

## Other Issues

### Config file not found

**Symptom**: API returns 500 with "No qagent.yaml found"

**Fix**: Ensure config exists in the directory where you run `qagent start`, or symlink it:

```bash
ln -s /path/to/qagent.yaml packages/web/qagent.yaml
```
