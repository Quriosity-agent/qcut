import type {
	Agent,
	OrchestratorConfig,
	PluginRegistry,
	ProjectConfig,
	Runtime,
	SCM,
	Session,
	Tracker,
	Workspace,
} from "./types.js";

export interface ResolvedPlugins {
	runtime: Runtime | null;
	agent: Agent | null;
	workspace: Workspace | null;
	tracker: Tracker | null;
	scm: SCM | null;
}

export interface ProjectSessionEntry {
	sessionName: string;
	projectId: string;
}

export interface SessionManagerContext {
	config: OrchestratorConfig;
	registry: PluginRegistry;
	getProjectSessionsDir: (project: ProjectConfig) => string;
	listAllSessions: (projectIdFilter?: string) => ProjectSessionEntry[];
	resolvePlugins: (
		project: ProjectConfig,
		agentOverride?: string
	) => ResolvedPlugins;
	ensureHandleAndEnrich: (
		session: Session,
		sessionName: string,
		project: ProjectConfig,
		plugins: ResolvedPlugins
	) => Promise<void>;
	enrichSessionWithRuntimeState: (
		session: Session,
		plugins: ResolvedPlugins,
		handleFromMetadata: boolean
	) => Promise<void>;
}
