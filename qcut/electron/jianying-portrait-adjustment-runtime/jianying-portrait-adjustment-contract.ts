export const JIANYING_PORTRAIT_ADJUSTMENT_INSPECT_CHANNEL =
	"jianying-portrait-adjustment:inspect";
export const JIANYING_PORTRAIT_ADJUSTMENT_RENDER_CHANNEL =
	"jianying-portrait-adjustment:render";

export type JianyingPortraitAdjustmentGroup = "face" | "body";
export type JianyingPortraitAdjustmentSection =
	| "skin"
	| "face-shape"
	| "features"
	| "body";
export type JianyingPortraitAdjustmentCategory =
	| "common"
	| "skin"
	| "eyes"
	| "nose"
	| "mouth"
	| "brows"
	| "details"
	| "body";
export type JianyingPortraitAdjustmentRuntimePackage =
	| "face"
	| "features"
	| "feature-tilt"
	| "smile"
	| "nose-3d"
	| "nose-sculpt"
	| "nose-upturned"
	| "nose-hump"
	| "brow-shape"
	| "eye-details"
	| "skin-tone"
	| "smooth"
	| "whiten"
	| "clarity"
	| "skin-gan"
	| "small-face"
	| "jawline"
	| "spot-acne"
	| "teeth"
	| "makeup"
	| "manual-smooth"
	| "manual-acne"
	| "manual-deformation"
	| "manual-stretch"
	| "manual-slim"
	| "manual-zoom"
	| "body";

export type MediaPortraitAdjustmentKey =
	| "face_adjust_TotalFace"
	| "face_adjust_EyeSpacing"
	| "face_adjust_EnlargeEye"
	| "face_adjust_MoveEye"
	| "face_adjust_EyeTilted"
	| "face_adjust_Nose"
	| "face_adjust_MoveNose"
	| "face_adjust_MoveMouth"
	| "face_adjust_MouthTilted"
	| "face_adjust_Smile"
	| "face_adjust_ZoomMouth"
	| "face_adjust_Chin"
	| "face_adjust_Forehead"
	| "face_adjust_CutFace"
	| "face_adjust_SmallFace"
	| "face_adjust_ZoomJawbone"
	| "face_adjust_ZoomCheekbone"
	| "face_adjust_MouthCorner"
	| "face_adjust_CornerEye"
	| "face_adjust_ChinSharp"
	| "face_adjust_VFace"
	| "face_adjust_skin_Intensity"
	| "face_adjust_skin_ColdWarm"
	| "face_adjust_outer_corner"
	| "face_adjust_inner_corner"
	| "face_adjust_outer_corner_inout"
	| "face_adjust_eye_width"
	| "face_adjust_pupil"
	| "face_adjust_eye_height"
	| "face_adjust_eye"
	| "face_adjust_lower_eyelid"
	| "face_adjust_eye_position"
	| "face_adjust_eye_distance"
	| "face_adjust_nose"
	| "face_adjust_3DNose_Big"
	| "face_adjust_MaShengNose"
	| "face_adjust_XiaoQiaoBi"
	| "face_adjust_TuoFengNose"
	| "face_adjust_nose_bridge"
	| "face_adjust_nose_position"
	| "face_adjust_nose_root"
	| "face_adjust_nose_tip"
	| "face_adjust_nose_wing"
	| "face_adjust_brow_ridge"
	| "face_adjust_brow_size"
	| "face_adjust_brow_position"
	| "face_adjust_brow_tilt"
	| "face_adjust_brow_width"
	| "face_adjust_brow_distance"
	| "eyebrow_adjust_BiaoZhun"
	| "eyebrow_adjust_LiuYe"
	| "eyebrow_adjust_JianMei"
	| "face_adjust_mouse_width"
	| "face_adjust_mouse_corner"
	| "face_adjust_mouse"
	| "face_adjust_mouse_position"
	| "face_adjust_under_lip"
	| "face_adjust_upper_lip"
	| "face_adjust_lip_line"
	| "face_adjust_BrightEye"
	| "face_adjust_Pouch"
	| "face_adjust_NasolabialFolds"
	| "face_adjust_Smooth"
	| "face_adjust_Whiten"
	| "face_adjust_Clarity"
	| "face_adjust_yunfu"
	| "face_adjust_fuling"
	| "face_adjust_lunkuopinghua"
	| "face_adjust_YouTaiFace"
	| "face_adjust_XiaHeXian"
	| "face_adjust_SpotAcne"
	| "face_adjust_WhiteTeeth"
	| "face_adjust_temple"
	| "face_adjust_cheekbone"
	| "face_adjust_pointy_chin"
	| "face_adjust_jaw"
	| "face_adjust_underjaw"
	| "face_adjust_upper_atrium"
	| "face_adjust_mid_atrium"
	| "face_adjust_lower_atrium"
	| "body_adjust_SmallHead"
	| "body_adjust_SwanNeck"
	| "body_adjust_SlimArm"
	| "body_adjust_OrthoShoulder"
	| "body_adjust_WidenShoulderTest"
	| "body_adjust_SlimBody"
	| "body_adjust_SlimWaist"
	| "body_adjust_StretchLeg"
	| "body_adjust_SlimBreast"
	| "body_adjust_SlimHip";

export type MediaPortraitMakeupCategory =
	| "look"
	| "lip"
	| "blush"
	| "contour"
	| "aegyo"
	| "brows"
	| "lashes"
	| "eyeliner"
	| "eyeshadow"
	| "contacts"
	| "highlight"
	| "freckles";

export interface MediaPortraitMakeupSelection {
	cardId: string;
	intensity: number;
}

export interface MediaPortraitFaceTarget {
	mode: "all" | "single";
	faceId?: number;
}

export interface MediaPortraitPersonBindingAnchor {
	rect: { x: number; y: number; width: number; height: number };
	frameNumber?: number;
}

/** One person's project-level adjustment set. */
export interface MediaPortraitFaceAdjustments {
	/**
	 * Last confirmed freid trackid. It is valid only in the current tracking
	 * session and is never the persisted person identity by itself.
	 */
	trackId: number;
	personBindingId?: string;
	bindingAnchor?: MediaPortraitPersonBindingAnchor;
	values: Partial<Record<MediaPortraitAdjustmentKey, number>>;
	makeup?: Partial<
		Record<MediaPortraitMakeupCategory, MediaPortraitMakeupSelection>
	>;
}

export type MediaPortraitManualRetouchTool = "smooth" | "acne";
export type MediaPortraitManualRetouchMode = "paint" | "erase";

export interface MediaPortraitManualRetouchStroke {
	id: string;
	tool: MediaPortraitManualRetouchTool;
	mode: MediaPortraitManualRetouchMode;
	size: number;
	intensity: number;
	points: { x: number; y: number }[];
	faceTrackId?: number;
}

export type MediaPortraitManualBodyTool = "stretch" | "slim" | "zoom";

export interface MediaPortraitManualBodyStretch {
	intensity: number;
	upper: number;
	bottom: number;
}

export interface MediaPortraitManualBodySlim {
	intensity: number;
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
}

export interface MediaPortraitManualBodyZoom {
	intensity: number;
	x: number;
	y: number;
	radius: number;
}

export interface MediaPortraitManualBody {
	stretch?: MediaPortraitManualBodyStretch;
	slim?: MediaPortraitManualBodySlim;
	zoom?: MediaPortraitManualBodyZoom;
}

export interface MediaPortraitAdjustments {
	enabled: boolean;
	/** Global skin LUT; absent keeps legacy pink, null explicitly disables it. */
	skinToneResourceId?: MediaPortraitSkinToneResourceId | null;
	values: Partial<Record<MediaPortraitAdjustmentKey, number>>;
	faceTarget?: MediaPortraitFaceTarget;
	makeup?: Partial<
		Record<MediaPortraitMakeupCategory, MediaPortraitMakeupSelection>
	>;
	/**
	 * Optional per-person adjustment sets. Absent on every legacy project and
	 * omitted again by normalize whenever empty, so stored legacy shapes stay
	 * byte-identical. Entries are deduped by trackId (first wins), sorted
	 * ascending, and capped at the native 10-face tracking limit.
	 */
	faces?: MediaPortraitFaceAdjustments[];
	manualRetouch?: { strokes: MediaPortraitManualRetouchStroke[] };
	manualBody?: MediaPortraitManualBody;
}

export type MediaPortraitSkinToneResourceId =
	| "7408757645705743616"
	| "7408757645705760000"
	| "7408757645705776384"
	| "7408757645705792768"
	| "7408757645705809152";

export interface JianyingPortraitSkinToneStatus {
	resourceId: MediaPortraitSkinToneResourceId;
	titleZh: string;
	titleEn: string;
	color: string;
	defaultIntensity: number;
	ready: boolean;
	source: "qcut-private" | "jianying-installation" | "none";
}

export interface JianyingPortraitAdjustmentControl {
	key: MediaPortraitAdjustmentKey;
	group: JianyingPortraitAdjustmentGroup;
	section: JianyingPortraitAdjustmentSection;
	category?: JianyingPortraitAdjustmentCategory;
	runtimePackage?: JianyingPortraitAdjustmentRuntimePackage;
	titleZh: string;
	titleEn: string;
	min: number;
	max: number;
	step: number;
}

export type JianyingPortraitAdjustmentRuntimeState =
	| "ready"
	| "unsupported-platform"
	| "bridge-missing"
	| "runtime-incompatible"
	| "model-missing"
	| "package-missing"
	| "error";

export interface JianyingPortraitAdjustmentPackageStatus {
	group: JianyingPortraitAdjustmentGroup;
	runtimePackage: JianyingPortraitAdjustmentRuntimePackage;
	ready: boolean;
	message?: string;
	source: "qcut-private" | "jianying-installation" | "none";
}

export interface JianyingPortraitMakeupCardStatus {
	id: string;
	category: MediaPortraitMakeupCategory;
	titleZh: string;
	titleEn: string;
	defaultIntensity: number;
	/** Retained for saved selections, not offered as a new makeup choice. */
	legacyOnly?: boolean;
	ready: boolean;
	source: "qcut-private" | "jianying-installation" | "none";
	thumbnailDataUrl?: string;
}

export interface JianyingPortraitAdjustmentStatus {
	state: JianyingPortraitAdjustmentRuntimeState;
	message: string;
	provider: "jianying-local-swing-v1";
	available: boolean;
	offlineReady: boolean;
	catalog: JianyingPortraitAdjustmentControl[];
	packages: JianyingPortraitAdjustmentPackageStatus[];
	makeupCards: JianyingPortraitMakeupCardStatus[];
	skinTones?: JianyingPortraitSkinToneStatus[];
}

export interface JianyingPortraitAdjustmentInspectRequest {
	refresh?: boolean;
}

export interface JianyingPortraitAdjustmentRenderRequest {
	width: number;
	height: number;
	rgba: Uint8Array;
	adjustments: MediaPortraitAdjustments;
	sourceKey?: string;
	frameNumber?: number;
	timestampSeconds?: number;
	sourcePreRoll?: JianyingPortraitSourcePreRoll;
	/**
	 * Start from a cold face tracker. Still-photo comparisons set this so a render never
	 * depends on the edits rendered before it for the same source.
	 */
	freshTracking?: boolean;
}

export interface JianyingPortraitSourcePreRoll {
	sourceKey: string;
	/** Real preceding source frames, in presentation order, at target dimensions. */
	frames: { timestampSeconds: number; rgba: Uint8Array }[];
}

export const PORTRAIT_SOURCE_PRE_ROLL_LIMITS = {
	frames: 16,
	seconds: 0.5,
	bytes: 64 * 1024 * 1024,
} as const;

export interface JianyingPortraitAdjustmentRenderResult {
	provider: "jianying-local-swing-v1";
	width: number;
	height: number;
	rgba: Uint8Array;
	activeGroups: JianyingPortraitAdjustmentGroup[];
	/** A face stage stayed unchanged; this is not a detector result or success claim. */
	needsSourcePreRoll?: boolean;
}

export const JIANYING_PORTRAIT_ADJUSTMENT_DETECT_CHANNEL =
	"jianying-portrait-adjustment:detect";

/** One face the native runtime is currently tracking on a frame. */
export interface JianyingPortraitDetectedFace {
	/**
	 * Compatibility alias for `freidTrackId`. It is never the base face id.
	 */
	trackId: number;
	/** Base face_0 detector id; useful only to join one frame's algorithm data. */
	faceId: number;
	/** Session-local freid_0 identity used by native parameter vectors. */
	freidTrackId: number;
	/** Project identity assigned after confidence-gated geometry matching. */
	personBindingId: string;
	bindingStatus: "matched" | "new";
	/** Centre-independent box in 0..1 of the frame: x, y, width, height. */
	rect: { x: number; y: number; width: number; height: number };
	score: number;
	yaw: number;
	pitch: number;
	roll: number;
	/** Frames this identity has been tracked for; 0 means freshly acquired. */
	trackingCount: number;
	landmarkCount: number;
}

export interface JianyingPortraitAdjustmentDetectRequest {
	width: number;
	height: number;
	rgba: Uint8Array;
	/** Same preview source identity used by render requests when available. */
	sourceKey?: string;
	frameNumber?: number;
	personBindings?: {
		personBindingId: string;
		anchor: MediaPortraitPersonBindingAnchor;
	}[];
}

export interface JianyingPortraitAdjustmentDetectResult {
	provider: "jianying-local-swing-v1";
	faces: JianyingPortraitDetectedFace[];
	/**
	 * Only the first five tracked faces receive effects, so the UI must say so
	 * rather than silently ignoring selections beyond the cap.
	 */
	appliedFaceLimit: number;
	/** Existing project identities that could not be bound without ambiguity. */
	unmatchedPersonBindingIds: string[];
}

export interface JianyingPortraitAdjustmentAPI {
	inspect: (
		request?: JianyingPortraitAdjustmentInspectRequest
	) => Promise<JianyingPortraitAdjustmentStatus>;
	render: (
		request: JianyingPortraitAdjustmentRenderRequest
	) => Promise<JianyingPortraitAdjustmentRenderResult>;
	detect: (
		request: JianyingPortraitAdjustmentDetectRequest
	) => Promise<JianyingPortraitAdjustmentDetectResult>;
}
