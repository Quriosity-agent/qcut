import type {
	RemotionStore,
	RemotionComponentDefinition,
	RemotionComponentCategory,
} from "@/lib/remotion/types";

type SetFn = (
	partial:
		| Partial<RemotionStore>
		| ((state: RemotionStore) => Partial<RemotionStore>)
) => void;
type GetFn = () => RemotionStore;

export function createRegistryActions(set: SetFn, get: GetFn) {
	return {
		registerComponent: (definition: RemotionComponentDefinition) => {
			set((state) => {
				const newComponents = new Map(state.registeredComponents);
				newComponents.set(definition.id, definition);
				return { registeredComponents: newComponents };
			});
		},

		unregisterComponent: (id: string) => {
			set((state) => {
				const newComponents = new Map(state.registeredComponents);
				newComponents.delete(id);
				return { registeredComponents: newComponents };
			});
		},

		getComponent: (id: string) => {
			return get().registeredComponents.get(id);
		},

		getComponentsByCategory: (category: RemotionComponentCategory) => {
			const components = Array.from(get().registeredComponents.values());
			return components.filter((c) => c.category === category);
		},
	};
}
