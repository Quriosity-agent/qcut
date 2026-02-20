export const PanelView = {
	PROPERTIES: "properties",
	EXPORT: "export",
	SETTINGS: "settings",
} as const;

export type PanelViewType = (typeof PanelView)[keyof typeof PanelView];
