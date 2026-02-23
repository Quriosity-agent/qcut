/**
 * Shot Size, Camera Angle, Camera Movement, Camera Rig, Focal Length, Movement Speed presets
 */

export const SHOT_SIZE_PRESETS = [
	{
		id: "ws",
		label: "Wide Shot",
		abbr: "WS",
		promptToken: "wide shot, establishing shot, distant view",
	},
	{
		id: "ls",
		label: "Long Shot",
		abbr: "LS",
		promptToken: "long shot, full body shot",
	},
	{
		id: "mls",
		label: "Medium Long Shot",
		abbr: "MLS",
		promptToken: "medium long shot, knee shot",
	},
	{
		id: "ms",
		label: "Medium Shot",
		abbr: "MS",
		promptToken: "medium shot, waist shot",
	},
	{
		id: "mcu",
		label: "Medium Close-Up",
		abbr: "MCU",
		promptToken: "medium close-up, chest shot",
	},
	{
		id: "cu",
		label: "Close-Up",
		abbr: "CU",
		promptToken: "close-up, face shot",
	},
	{
		id: "ecu",
		label: "Extreme Close-Up",
		abbr: "ECU",
		promptToken: "extreme close-up, detail shot",
	},
	{
		id: "pov",
		label: "POV Shot",
		abbr: "POV",
		promptToken: "point of view shot, first person perspective",
	},
] as const;

export type ShotSizeType = (typeof SHOT_SIZE_PRESETS)[number]["id"];

export const CAMERA_ANGLE_PRESETS = [
	{
		id: "eye-level" as const,
		label: "Eye Level",
		emoji: "\uD83D\uDC41\uFE0F",
		promptToken: "eye level angle,",
	},
	{
		id: "high-angle" as const,
		label: "High Angle",
		emoji: "\u2B07\uFE0F",
		promptToken: "high angle shot, looking down,",
	},
	{
		id: "low-angle" as const,
		label: "Low Angle",
		emoji: "\u2B06\uFE0F",
		promptToken: "low angle shot, looking up, heroic perspective,",
	},
	{
		id: "birds-eye" as const,
		label: "Bird's Eye",
		emoji: "\uD83E\uDD85",
		promptToken: "bird's eye view, top-down overhead shot,",
	},
	{
		id: "worms-eye" as const,
		label: "Worm's Eye",
		emoji: "\uD83D\uDC1B",
		promptToken: "worm's eye view, extreme low angle from ground,",
	},
	{
		id: "over-shoulder" as const,
		label: "Over Shoulder",
		emoji: "\uD83E\uDEF2",
		promptToken: "over the shoulder shot, OTS,",
	},
	{
		id: "side-angle" as const,
		label: "Side Angle",
		emoji: "\u2194\uFE0F",
		promptToken: "side angle, profile view,",
	},
	{
		id: "dutch-angle" as const,
		label: "Dutch Angle",
		emoji: "\uD83D\uDCD0",
		promptToken: "dutch angle, tilted frame, canted angle,",
	},
	{
		id: "third-person" as const,
		label: "Third Person",
		emoji: "\uD83C\uDFAE",
		promptToken: "third person perspective, slightly behind and above subject,",
	},
] as const;

export type CameraAngleType = (typeof CAMERA_ANGLE_PRESETS)[number]["id"];

export const CAMERA_MOVEMENT_PRESETS = [
	{ id: "none" as const, label: "None", promptToken: "" },
	{
		id: "static" as const,
		label: "Static",
		promptToken: "static camera, locked off,",
	},
	{
		id: "tracking" as const,
		label: "Tracking",
		promptToken: "tracking shot, following subject,",
	},
	{
		id: "orbit" as const,
		label: "Orbit",
		promptToken: "orbiting around subject, circular camera movement,",
	},
	{
		id: "zoom-in" as const,
		label: "Zoom In",
		promptToken: "zoom in, lens zooming closer,",
	},
	{
		id: "zoom-out" as const,
		label: "Zoom Out",
		promptToken: "zoom out, lens zooming wider,",
	},
	{
		id: "pan-left" as const,
		label: "Pan Left",
		promptToken: "pan left, horizontal camera rotation left,",
	},
	{
		id: "pan-right" as const,
		label: "Pan Right",
		promptToken: "pan right, horizontal camera rotation right,",
	},
	{
		id: "tilt-up" as const,
		label: "Tilt Up",
		promptToken: "tilt up, camera tilting upward,",
	},
	{
		id: "tilt-down" as const,
		label: "Tilt Down",
		promptToken: "tilt down, camera tilting downward,",
	},
	{
		id: "dolly-in" as const,
		label: "Dolly In",
		promptToken: "dolly in, camera pushing forward,",
	},
	{
		id: "dolly-out" as const,
		label: "Dolly Out",
		promptToken: "dolly out, camera pulling back,",
	},
	{
		id: "truck-left" as const,
		label: "Truck Left",
		promptToken: "truck left, lateral camera movement left,",
	},
	{
		id: "truck-right" as const,
		label: "Truck Right",
		promptToken: "truck right, lateral camera movement right,",
	},
	{
		id: "crane-up" as const,
		label: "Crane Up",
		promptToken: "crane up, camera ascending vertically,",
	},
	{
		id: "crane-down" as const,
		label: "Crane Down",
		promptToken: "crane down, camera descending vertically,",
	},
	{
		id: "drone-aerial" as const,
		label: "Drone Aerial",
		promptToken: "drone aerial shot, sweeping aerial movement,",
	},
	{
		id: "360-roll" as const,
		label: "360 Roll",
		promptToken: "360 degree barrel roll, rotating camera,",
	},
] as const;

export type CameraMovementType = (typeof CAMERA_MOVEMENT_PRESETS)[number]["id"];

export const CAMERA_RIG_PRESETS = [
	{
		id: "tripod" as const,
		label: "Tripod",
		emoji: "\uD83D\uDCD0",
		promptToken: "static tripod shot,",
	},
	{
		id: "handheld" as const,
		label: "Handheld",
		emoji: "\uD83E\uDD32",
		promptToken: "handheld camera, slight shake, documentary feel,",
	},
	{
		id: "steadicam" as const,
		label: "Steadicam",
		emoji: "\uD83C\uDFA5",
		promptToken: "smooth steadicam shot,",
	},
	{
		id: "dolly" as const,
		label: "Dolly",
		emoji: "\uD83D\uDEE4\uFE0F",
		promptToken: "dolly tracking shot, smooth rail movement,",
	},
	{
		id: "crane" as const,
		label: "Crane",
		emoji: "\uD83C\uDFD7\uFE0F",
		promptToken: "crane shot, sweeping vertical movement,",
	},
	{
		id: "drone" as const,
		label: "Drone",
		emoji: "\uD83D\uDE81",
		promptToken: "aerial drone shot, bird's eye perspective,",
	},
	{
		id: "shoulder" as const,
		label: "Shoulder",
		emoji: "\uD83D\uDCAA",
		promptToken: "shoulder-mounted camera, subtle movement,",
	},
	{
		id: "slider" as const,
		label: "Slider",
		emoji: "\u2194\uFE0F",
		promptToken: "slider shot, short smooth lateral movement,",
	},
] as const;

export const MOVEMENT_SPEED_PRESETS = [
	{
		id: "very-slow" as const,
		label: "Very Slow",
		promptToken: "very slow camera movement,",
	},
	{ id: "slow" as const, label: "Slow", promptToken: "slow camera movement," },
	{ id: "normal" as const, label: "Normal", promptToken: "" },
	{ id: "fast" as const, label: "Fast", promptToken: "fast camera movement," },
	{
		id: "very-fast" as const,
		label: "Very Fast",
		promptToken: "very fast camera movement,",
	},
] as const;

export const FOCAL_LENGTH_PRESETS = [
	{
		id: "8mm" as const,
		label: "8mm Fisheye",
		emoji: "\uD83D\uDC1F",
		promptToken:
			"8mm fisheye lens, extreme barrel distortion, ultra wide field of view,",
	},
	{
		id: "14mm" as const,
		label: "14mm Ultra Wide",
		emoji: "\uD83C\uDF10",
		promptToken: "14mm ultra wide angle lens, dramatic perspective distortion,",
	},
	{
		id: "24mm" as const,
		label: "24mm Wide",
		emoji: "\uD83C\uDFD4\uFE0F",
		promptToken:
			"24mm wide angle lens, environmental context, slight perspective exaggeration,",
	},
	{
		id: "35mm" as const,
		label: "35mm Standard Wide",
		emoji: "\uD83D\uDCF7",
		promptToken:
			"35mm lens, natural wide perspective, street photography feel,",
	},
	{
		id: "50mm" as const,
		label: "50mm Standard",
		emoji: "\uD83D\uDC41\uFE0F",
		promptToken: "50mm standard lens, natural human eye perspective,",
	},
	{
		id: "85mm" as const,
		label: "85mm Portrait",
		emoji: "\uD83E\uDDD1",
		promptToken:
			"85mm portrait lens, flattering facial proportions, smooth background compression,",
	},
	{
		id: "105mm" as const,
		label: "105mm Medium Tele",
		emoji: "\uD83D\uDD2D",
		promptToken: "105mm medium telephoto, gentle background compression,",
	},
	{
		id: "135mm" as const,
		label: "135mm Telephoto",
		emoji: "\uD83D\uDCE1",
		promptToken:
			"135mm telephoto lens, strong background compression, subject isolation,",
	},
	{
		id: "200mm" as const,
		label: "200mm Long Tele",
		emoji: "\uD83D\uDD2C",
		promptToken:
			"200mm telephoto, extreme background compression, flattened perspective,",
	},
	{
		id: "400mm" as const,
		label: "400mm Super Tele",
		emoji: "\uD83D\uDEF0\uFE0F",
		promptToken:
			"400mm super telephoto, extreme compression, distant subject isolation,",
	},
] as const;

export type FocalLengthType = (typeof FOCAL_LENGTH_PRESETS)[number]["id"];
