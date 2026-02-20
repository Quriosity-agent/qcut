import {
	CAMERAS,
	LENSES,
	FOCAL_LENGTHS,
	APERTURE_OPTIONS,
} from "@/stores/camera-selector-store";

export interface CameraPromptOptions {
	cameraIndex: number;
	lensIndex: number;
	focalIndex: number;
	apertureIndex: number;
	/** Optional user subject/scene appended to the camera prompt */
	subject?: string;
}

const CAMERA_TYPE_FLAVOR: Record<string, string> = {
	DIGITAL: "digital cinema look, clean sensor rendering",
	FILM: "organic film grain, photochemical texture",
};

const LENS_TYPE_TRAITS: Record<string, string> = {
	SPHERICAL: "natural bokeh, even field rendering",
	ANAMORPHIC: "horizontal lens flare, oval bokeh, widescreen character",
	SPECIAL: "creative optical distortion, unique rendering",
};

const FOCAL_DESCRIPTION: Record<number, string> = {
	8: "ultra-wide perspective, dramatic spatial distortion",
	14: "wide-angle view, expansive environmental framing",
	35: "standard cinematic field of view, natural perspective",
	50: "natural perspective, classic portrait framing",
};

const APERTURE_DESCRIPTION: Record<string, string> = {
	"f/1.4": "shallow depth of field, strong subject isolation",
	"f/4": "moderate depth of field, balanced sharpness",
	"f/11": "deep focus, sharp foreground to background",
};

export function buildCameraPrompt(options: CameraPromptOptions): string {
	const camera = CAMERAS[options.cameraIndex] ?? CAMERAS[0];
	const lens = LENSES[options.lensIndex] ?? LENSES[0];
	const focal = FOCAL_LENGTHS[options.focalIndex] ?? FOCAL_LENGTHS[3];
	const aperture =
		APERTURE_OPTIONS[options.apertureIndex] ?? APERTURE_OPTIONS[0];

	const parts: string[] = [
		`Cinematic shot on ${camera.name}`,
		`with ${lens.name} ${lens.type.toLowerCase()} lens at ${focal}mm ${aperture.label}`,
		CAMERA_TYPE_FLAVOR[camera.type] ?? "",
		LENS_TYPE_TRAITS[lens.type] ?? "",
		FOCAL_DESCRIPTION[focal] ?? "",
		APERTURE_DESCRIPTION[aperture.label] ?? "",
		"professional cinematography",
	];

	const cameraPrompt = parts.filter(Boolean).join(", ");

	if (options.subject?.trim()) {
		return `${options.subject.trim()}, ${cameraPrompt}`;
	}

	return cameraPrompt;
}
