import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import {
	BEAUTY_LAB_LIST_CHANNEL,
	BEAUTY_LAB_LOAD_CHANNEL,
} from "./beauty-lab-contract.js";
import { createBeautyLabResearchProvider } from "./beauty-lab-research.js";
import {
	BEAUTY_LAB_CANDIDATE_INSPECT_CHANNEL,
	BEAUTY_LAB_CANDIDATE_RENDER_CHANNEL,
} from "./beauty-lab-candidate-contract.js";
import { createBeautyLabCandidateProvider } from "./beauty-lab-candidate-provider.js";

let activeController: symbol | undefined;

export function setupBeautyLabIPC({
	getMainWindow,
	root,
	currentSourceRoot,
	provider = createBeautyLabResearchProvider({ root, currentSourceRoot }),
	candidateProvider = createBeautyLabCandidateProvider(),
}: {
	getMainWindow: () => BrowserWindow | null;
	root: string;
	currentSourceRoot: string;
	provider?: ReturnType<typeof createBeautyLabResearchProvider>;
	candidateProvider?: ReturnType<typeof createBeautyLabCandidateProvider>;
}) {
	const token = Symbol("beauty-lab-controller");
	activeController = token;
	function assertTrusted({ event }: { event: IpcMainInvokeEvent }) {
		const window = getMainWindow();
		if (
			!window ||
			window.isDestroyed() ||
			window.webContents.isDestroyed() ||
			event.sender !== window.webContents ||
			!event.senderFrame ||
			event.senderFrame !== window.webContents.mainFrame
		) {
			throw new Error("Beauty Lab requires the trusted main window");
		}
	}

	ipcMain.removeHandler(BEAUTY_LAB_LIST_CHANNEL);
	ipcMain.removeHandler(BEAUTY_LAB_LOAD_CHANNEL);
	ipcMain.removeHandler(BEAUTY_LAB_CANDIDATE_INSPECT_CHANNEL);
	ipcMain.removeHandler(BEAUTY_LAB_CANDIDATE_RENDER_CHANNEL);
	ipcMain.handle(BEAUTY_LAB_CANDIDATE_INSPECT_CHANNEL, (event) => {
		assertTrusted({ event });
		return candidateProvider.inspect();
	});
	ipcMain.handle(
		BEAUTY_LAB_CANDIDATE_RENDER_CHANNEL,
		(event, request: unknown) => {
			assertTrusted({ event });
			return candidateProvider.render({ request });
		}
	);
	ipcMain.handle(BEAUTY_LAB_LIST_CHANNEL, (event) => {
		assertTrusted({ event });
		return provider.list();
	});
	ipcMain.handle(BEAUTY_LAB_LOAD_CHANNEL, (event, request: unknown) => {
		assertTrusted({ event });
		if (!request || typeof request !== "object" || Array.isArray(request)) {
			throw new Error("Invalid Beauty Lab research request");
		}
		const { caseId, frameIndex } = request as Record<string, unknown>;
		if (
			typeof caseId !== "string" ||
			typeof frameIndex !== "number" ||
			!Number.isInteger(frameIndex) ||
			frameIndex < 0 ||
			frameIndex >= 7
		) {
			throw new Error("Invalid Beauty Lab case or frame index");
		}
		return provider.load({ caseId, frameIndex });
	});
	return {
		dispose: () => {
			if (activeController !== token) return;
			activeController = undefined;
			ipcMain.removeHandler(BEAUTY_LAB_LIST_CHANNEL);
			ipcMain.removeHandler(BEAUTY_LAB_LOAD_CHANNEL);
			ipcMain.removeHandler(BEAUTY_LAB_CANDIDATE_INSPECT_CHANNEL);
			ipcMain.removeHandler(BEAUTY_LAB_CANDIDATE_RENDER_CHANNEL);
		},
	};
}
