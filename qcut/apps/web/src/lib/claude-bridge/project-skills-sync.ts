import type { ElectronAPI } from "@/types/electron";

interface SyncProjectSkillsForClaudeInput {
	projectId: string;
	electronApi?: ElectronAPI;
}

function getElectronApi({
	electronApi,
}: {
	electronApi?: ElectronAPI;
}): ElectronAPI | undefined {
	if (electronApi) {
		return electronApi;
	}
	if (typeof window === "undefined") {
		return;
	}
	return window.electronAPI;
}

export function syncProjectSkillsForClaude({
	projectId,
	electronApi,
}: SyncProjectSkillsForClaudeInput): void {
	try {
		const resolvedElectronApi = getElectronApi({ electronApi });
		const syncForClaude = resolvedElectronApi?.skills?.syncForClaude;
		if (!syncForClaude) {
			return;
		}
		syncForClaude(projectId).catch((error: unknown) => {
			console.warn("[ProjectStore] skills syncForClaude failed", error);
		});
	} catch (error: unknown) {
		console.warn("[ProjectStore] skills syncForClaude failed", error);
	}
}
