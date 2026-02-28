import type { RemotionStore } from "@/lib/remotion/types";
import {
	getSequenceAnalysisService,
	type AnalysisResult,
} from "@/lib/remotion/sequence-analysis-service";

type SetFn = (
	partial:
		| Partial<RemotionStore>
		| ((state: RemotionStore) => Partial<RemotionStore>)
) => void;
type GetFn = () => RemotionStore;

export function createAnalysisActions(set: SetFn, get: GetFn) {
	return {
		setAnalysisResult: (componentId: string, result: AnalysisResult) => {
			set((state) => {
				const newMap = new Map(state.analyzedSequences);
				newMap.set(componentId, result);
				return { analyzedSequences: newMap };
			});
		},

		getAnalysisResult: (componentId: string) => {
			return get().analyzedSequences.get(componentId);
		},

		clearAnalysisResult: (componentId: string) => {
			set((state) => {
				const newMap = new Map(state.analyzedSequences);
				newMap.delete(componentId);
				return { analyzedSequences: newMap };
			});
		},

		analyzeComponentSource: async (componentId: string, sourceCode: string) => {
			const service = getSequenceAnalysisService();
			const result = await service.analyzeComponent(componentId, sourceCode);
			get().setAnalysisResult(componentId, result);

			if (result.structure) {
				set((state) => {
					const components = new Map(state.registeredComponents);
					const existing = components.get(componentId);
					if (existing && !existing.sequenceStructure) {
						components.set(componentId, {
							...existing,
							sequenceStructure: result.structure!,
						});
						return { registeredComponents: components };
					}
					return state;
				});
			}

			return result;
		},
	};
}
