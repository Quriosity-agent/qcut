import {
	loadConfig,
	createSessionManager,
	createPluginRegistry,
	createLifecycleManager,
} from "./packages/core/dist/index.js";

// Import plugins directly since workspace links aren't at the root
import runtimeTmux from "./packages/plugins/runtime-tmux/dist/index.js";
import agentCodex from "./packages/plugins/agent-codex/dist/index.js";
import agentClaudeCode from "./packages/plugins/agent-claude-code/dist/index.js";
import workspaceWorktree from "./packages/plugins/workspace-worktree/dist/index.js";
import trackerGithub from "./packages/plugins/tracker-github/dist/index.js";
import scmGithub from "./packages/plugins/scm-github/dist/index.js";
import notifierDesktop from "./packages/plugins/notifier-desktop/dist/index.js";

const config = loadConfig();
const registry = createPluginRegistry();

// Register plugins
registry.register(runtimeTmux);
registry.register(agentCodex);
registry.register(agentClaudeCode);
registry.register(workspaceWorktree);
registry.register(trackerGithub);
registry.register(scmGithub);
registry.register(notifierDesktop);

const sessionManager = createSessionManager({ config, registry });

const lm = createLifecycleManager({ config, registry, sessionManager });

console.log(
	`[${new Date().toISOString()}] Lifecycle manager started (30s polling)`
);
console.log(`Watching ${Object.keys(config.projects).length} project(s)...`);
lm.start(30_000);

// Log each cycle
setInterval(() => {
	console.log(`[${new Date().toISOString()}] poll cycle`);
}, 30_000);
