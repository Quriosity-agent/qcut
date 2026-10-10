import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import {
	BEAUTY_LAB_LIST_CHANNEL,
	BEAUTY_LAB_LOAD_CHANNEL,
} from "./beauty-lab-contract.js";
import { createBeautyLabResearchProvider } from "./beauty-lab-research.js";
import { createBeautyLabOwnedChainProvider } from "./beauty-lab-owned-chain.js";
import { OWNED_CHAIN_CASE_ID } from "./beauty-lab-owned-chain-evidence.js";
import {
	BEAUTY_LAB_CANDIDATE_CANCEL_CHANNEL,
	BEAUTY_LAB_CANDIDATE_INSPECT_CHANNEL,
	BEAUTY_LAB_CANDIDATE_RENDER_CHANNEL,
} from "./beauty-lab/beauty-lab-candidate-contract.js";
import { createBeautyLabCandidateProvider } from "./beauty-lab-candidate-provider.js";
import {
	BEAUTY_LAB_INDEPENDENT_INSPECT,
	BEAUTY_LAB_INDEPENDENT_RENDER,
	BEAUTY_LAB_INDEPENDENT_CANCEL,
} from "./beauty-lab-independent-contract.js";
import type { createBeautyLabIndependentProvider } from "./beauty-lab-independent.js";

let activeController: symbol | undefined;

export function setupBeautyLabIPC({
	getMainWindow,
	root,
	currentSourceRoot,
	ownedChainRoot,
	provider = createBeautyLabResearchProvider({ root, currentSourceRoot }),
	candidateProvider = createBeautyLabCandidateProvider(),
	independentProvider,
}: {
	getMainWindow: () => BrowserWindow | null;
	root: string;
	currentSourceRoot: string;
	ownedChainRoot?: string;
	provider?: ReturnType<typeof createBeautyLabResearchProvider>;
	candidateProvider?: ReturnType<typeof createBeautyLabCandidateProvider>;
	independentProvider?: ReturnType<typeof createBeautyLabIndependentProvider>;
}) {
	const ownedChain = ownedChainRoot
		? createBeautyLabOwnedChainProvider({
				root: ownedChainRoot,
				currentSourceRoot,
			})
		: undefined;
	const token = Symbol("beauty-lab-controller");
	let disposal: Promise<void> | undefined;
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
	ipcMain.removeHandler(BEAUTY_LAB_CANDIDATE_CANCEL_CHANNEL);
	for (const channel of [
		BEAUTY_LAB_INDEPENDENT_INSPECT,
		BEAUTY_LAB_INDEPENDENT_RENDER,
		BEAUTY_LAB_INDEPENDENT_CANCEL,
	])
		ipcMain.removeHandler(channel);
	ipcMain.handle(BEAUTY_LAB_INDEPENDENT_INSPECT, (event) => {
		assertTrusted({ event });
		if (!independentProvider)
			throw new Error("Independent photo engine is not connected");
		return independentProvider.inspect();
	});
	ipcMain.handle(BEAUTY_LAB_INDEPENDENT_RENDER, (event, request: unknown) => {
		assertTrusted({ event });
		if (!independentProvider)
			throw new Error("Independent photo engine is not connected");
		return independentProvider.render({ request });
	});
	ipcMain.handle(
		BEAUTY_LAB_INDEPENDENT_CANCEL,
		(event, request: { requestId: string }) => {
			assertTrusted({ event });
			if (!independentProvider)
				throw new Error("Independent photo engine is not connected");
			return independentProvider.cancel({ request });
		}
	);
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
	ipcMain.handle(
		BEAUTY_LAB_CANDIDATE_CANCEL_CHANNEL,
		(event, request: unknown) => {
			assertTrusted({ event });
			return candidateProvider.cancel({ request });
		}
	);
	ipcMain.handle(BEAUTY_LAB_LIST_CHANNEL, async (event) => {
		assertTrusted({ event });
		const cases = await provider.list();
		return ownedChain ? [...cases, ...(await ownedChain.list())] : cases;
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
			frameIndex >= 7 ||
			Object.keys(request).some(
				(key) => key !== "caseId" && key !== "frameIndex"
			)
		) {
			throw new Error("Invalid Beauty Lab case or frame index");
		}
		return (
			caseId === OWNED_CHAIN_CASE_ID && ownedChain ? ownedChain : provider
		).load({ caseId, frameIndex });
	});
	return {
		dispose: (): Promise<void> => {
			if (activeController === token) {
				activeController = undefined;
				ipcMain.removeHandler(BEAUTY_LAB_LIST_CHANNEL);
				ipcMain.removeHandler(BEAUTY_LAB_LOAD_CHANNEL);
				ipcMain.removeHandler(BEAUTY_LAB_CANDIDATE_INSPECT_CHANNEL);
				ipcMain.removeHandler(BEAUTY_LAB_CANDIDATE_RENDER_CHANNEL);
				ipcMain.removeHandler(BEAUTY_LAB_CANDIDATE_CANCEL_CHANNEL);
				for (const channel of [
					BEAUTY_LAB_INDEPENDENT_INSPECT,
					BEAUTY_LAB_INDEPENDENT_RENDER,
					BEAUTY_LAB_INDEPENDENT_CANCEL,
				])
					ipcMain.removeHandler(channel);
			}
			disposal ??= Promise.all([
				candidateProvider.dispose(),
				independentProvider?.dispose(),
			]).then(() => {});
			return disposal;
		},
	};
}
