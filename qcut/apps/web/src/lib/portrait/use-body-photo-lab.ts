import { useCallback, useEffect, useRef, useState } from "react";
import type { BodyPhotoLabStatus } from "@/types/electron/api-body-photo-lab";

type Operation = "inspect" | "open" | "chooseRuntime" | "close";

interface PhotoLabState {
	status: BodyPhotoLabStatus | null;
	pending: Operation | null;
	error: string | null;
}

export function useBodyPhotoLab() {
	const api = window.electronAPI?.bodyPhotoLab;
	const generation = useRef(0);
	const active = useRef(false);
	const busy = useRef(false);
	const [state, setState] = useState<PhotoLabState>({
		status: null,
		pending: api ? "inspect" : null,
		error: null,
	});
	const execute = useCallback(
		async ({ operation }: { operation: Operation }) => {
			if (!api || !active.current || busy.current) return;
			busy.current = true;
			const requestGeneration = generation.current;
			setState((current) => ({ ...current, pending: operation, error: null }));
			try {
				let status: BodyPhotoLabStatus;
				if (operation === "open" || operation === "close") {
					await api[operation]();
					status = await api.inspect();
				} else {
					status = await api[operation]();
				}
				if (active.current && generation.current === requestGeneration) {
					setState({ status, pending: null, error: null });
				}
			} catch (reason) {
				if (active.current && generation.current === requestGeneration) {
					setState({
						status: null,
						pending: null,
						error: reason instanceof Error ? reason.message : String(reason),
					});
				}
			} finally {
				if (generation.current === requestGeneration) busy.current = false;
			}
		},
		[api]
	);
	useEffect(() => {
		active.current = true;
		generation.current += 1;
		busy.current = false;
		setState({ status: null, pending: api ? "inspect" : null, error: null });
		void execute({ operation: "inspect" });
		const refresh = () => void execute({ operation: "inspect" });
		window.addEventListener("focus", refresh);
		return () => {
			active.current = false;
			generation.current += 1;
			window.removeEventListener("focus", refresh);
		};
	}, [api, execute]);
	return { ...state, desktop: Boolean(api), execute };
}
