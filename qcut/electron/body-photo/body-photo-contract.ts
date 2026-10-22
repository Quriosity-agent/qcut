export const BODY_PHOTO_INSPECT = "body-photo:inspect";
export const BODY_PHOTO_OPEN = "body-photo:open";
export const BODY_PHOTO_CLOSE = "body-photo:close";
export const BODY_PHOTO_CHOOSE_RUNTIME = "body-photo:choose-runtime";
export const BODY_PHOTO_PROVIDER = "qcut-body-photo-cpu-v3" as const;

export interface BodyPhotoLabStatus {
	available: boolean;
	provider: typeof BODY_PHOTO_PROVIDER;
	message: string;
	runtimeConfigured: boolean;
	windowOpen: boolean;
	sourceManifestSha256?: string;
}

export interface BodyPhotoLabAPI {
	inspect: () => Promise<BodyPhotoLabStatus>;
	open: () => Promise<{ opened: true }>;
	close: () => Promise<{ closed: boolean }>;
	chooseRuntime: () => Promise<BodyPhotoLabStatus>;
}
