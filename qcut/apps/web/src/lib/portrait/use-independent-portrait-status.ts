import { useEffect, useState } from "react";
import type { BeautyLabIndependentStatus } from "@/types/electron";

interface IndependentPortraitRuntimeState {
	status: BeautyLabIndependentStatus | null;
	error: string | null;
	loading: boolean;
}

export function useIndependentPortraitStatus({
	enabled,
}: {
	enabled: boolean;
}) {
	const [state, setState] = useState<IndependentPortraitRuntimeState>({
		status: null,
		error: null,
		loading: enabled,
	});
	useEffect(() => {
		if (!enabled) return;
		let active = true;
		const clearInspection = () => {
			active = false;
			setState({ status: null, error: null, loading: true });
		};
		setState({ status: null, error: null, loading: true });
		const inspect = window.electronAPI?.beautyLab?.inspectIndependent;
		if (!inspect) {
			setState({
				status: null,
				error: "Requires QCut Desktop",
				loading: false,
			});
			return clearInspection;
		}
		void inspect().then(
			(status) => {
				if (active) setState({ status, error: null, loading: false });
			},
			(error: unknown) => {
				if (active)
					setState({
						status: null,
						error: error instanceof Error ? error.message : String(error),
						loading: false,
					});
			}
		);
		return clearInspection;
	}, [enabled]);
	return enabled ? state : { status: null, error: null, loading: false };
}
