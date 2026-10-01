import type { MediaPortraitMakeupCategory } from "../jianying-portrait-adjustment-contract.js";

export interface JianyingPortraitMakeupCardDefinition {
	id: string;
	category: MediaPortraitMakeupCategory;
	titleZh: string;
	titleEn: string;
	resourceId: string;
	version: string;
	parameterKey: string;
	defaultIntensity: number;
	kind: "dynamic" | "standalone";
	legacyOnly?: boolean;
}

type MakeupCardCatalog = readonly JianyingPortraitMakeupCardDefinition[];

export const JIANYING_PORTRAIT_MAKEUP_CARDS: MakeupCardCatalog = [
	{
		id: "look-oxygen",
		category: "look",
		titleZh: "氧气感",
		titleEn: "Fresh air",
		resourceId: "7406174119940721935",
		version: "1ec0e8e3d3145339e34dc072b884f235",
		parameterKey: "face_adjust_whole",
		defaultIntensity: 80,
		kind: "standalone",
	},
	{
		id: "lip-soft-pink",
		category: "lip",
		titleZh: "柔和粉",
		titleEn: "Soft pink",
		resourceId: "7408076694126365992",
		version: "3ff9996e22120348c34b3abbed86712c",
		parameterKey: "face_adjust_lip_yunranColorRHF",
		defaultIntensity: 80,
		kind: "dynamic",
	},
	{
		id: "lip-coral-nude",
		category: "lip",
		titleZh: "珊瑚裸粉",
		titleEn: "Coral nude",
		resourceId: "7406181389613190435",
		version: "e3ccb34c651dd1b57e6c2fb6532c6990",
		parameterKey: "face_adjust_lip_shanhuluofen",
		defaultIntensity: 80,
		kind: "dynamic",
	},
	{
		id: "blush-baby-pink",
		category: "blush",
		titleZh: "婴儿粉",
		titleEn: "Baby pink",
		resourceId: "7406180986888654120",
		version: "9591fdbc8cdd0806e91ffd334bdd5f7b",
		parameterKey: "face_adjust_blusher_yingerfen",
		defaultIntensity: 80,
		kind: "dynamic",
	},
	{
		id: "contour-mixed",
		category: "contour",
		titleZh: "混血",
		titleEn: "Sculpted",
		resourceId: "7406181489412427060",
		version: "6fe23753b9c46a79b6f617c054a3608e",
		parameterKey: "face_adjust_stereo_fajixian",
		defaultIntensity: 80,
		kind: "dynamic",
	},
	{
		id: "aegyo-natural",
		category: "aegyo",
		titleZh: "自然",
		titleEn: "Natural",
		resourceId: "7406180908924996879",
		version: "ca0e678b9394dd720b3c04379dfb48a3",
		parameterKey: "face_adjust_eyemazing_ziran",
		defaultIntensity: 80,
		kind: "dynamic",
	},
	{
		id: "brows-flow",
		category: "brows",
		titleZh: "流畅眉",
		titleEn: "Flowing brows",
		resourceId: "7406174746829737231",
		version: "b6c830cdf68c163cd3dc2139db6b1fee",
		parameterKey: "eyebrow_adjust_BiaoZhun",
		defaultIntensity: 70,
		kind: "standalone",
		// Geometric brow shaping; keep the mapping for saved makeup selections.
		legacyOnly: true,
	},
	{
		id: "brows-standard",
		category: "brows",
		titleZh: "标准眉",
		titleEn: "Standard brows",
		resourceId: "7406180431730707727",
		version: "1826bb4815f127fb3168b67ed4e0fc71",
		parameterKey: "face_adjust_brow_biaozhunmei",
		defaultIntensity: 80,
		kind: "dynamic",
	},
	{
		id: "brows-fluffy",
		category: "brows",
		titleZh: "绒绒眉",
		titleEn: "Fluffy brows",
		resourceId: "7406174643247123746",
		version: "a983387e6a01d830b4c4f9cbc6607628",
		parameterKey: "face_adjust_brow_rongrongmei",
		defaultIntensity: 80,
		kind: "dynamic",
	},
	{
		id: "brows-wild",
		category: "brows",
		titleZh: "野生眉",
		titleEn: "Wild brows",
		resourceId: "7406181254669929763",
		version: "2041638b555e988c0b6f13839b112659",
		parameterKey: "face_adjust_brow_yeshengmeiii",
		defaultIntensity: 80,
		kind: "dynamic",
	},
	{
		id: "brows-warrior",
		category: "brows",
		titleZh: "侠客眉",
		titleEn: "Warrior brows",
		resourceId: "7406174539454909730",
		version: "8feebde948245fa77c49ead859794fb1",
		parameterKey: "face_adjust_brow_xiakemei",
		defaultIntensity: 80,
		kind: "dynamic",
	},
	{
		id: "brows-classical",
		category: "brows",
		titleZh: "古韵眉",
		titleEn: "Classical brows",
		resourceId: "7406175039264951592",
		version: "212083cfb14f276308e23a3ee39a9034",
		parameterKey: "face_adjust_brow_guyunmeifree",
		defaultIntensity: 80,
		kind: "dynamic",
	},
	{
		id: "brows-soft",
		category: "brows",
		titleZh: "淡颜眉",
		titleEn: "Soft brows",
		resourceId: "7406174445548719394",
		version: "ed8ca9399d3ef88ea59931f6f57885a1",
		parameterKey: "face_adjust_brow_danyanmei",
		defaultIntensity: 80,
		kind: "dynamic",
	},
	{
		id: "lashes-natural-ii",
		category: "lashes",
		titleZh: "妈生感 II",
		titleEn: "Natural II",
		resourceId: "7406175199361649920",
		version: "2334785805777457e48251169bf65b10",
		parameterKey: "face_adjust_eyelash_mashengganer",
		defaultIntensity: 80,
		kind: "dynamic",
	},
	{
		id: "eyeliner-natural",
		category: "eyeliner",
		titleZh: "自然",
		titleEn: "Natural",
		resourceId: "7406174938438044943",
		version: "8ae3097fb95ca9006f57856fccd625be",
		parameterKey: "face_adjust_eyeline_ziran",
		defaultIntensity: 80,
		kind: "dynamic",
	},
	{
		id: "eyeliner-cat",
		category: "eyeliner",
		titleZh: "小野猫",
		titleEn: "Cat eye",
		resourceId: "7406174561663782159",
		version: "743f9d928016a361227154fa946b763b",
		parameterKey: "face_adjust_eyeline_xiaoyemao",
		defaultIntensity: 80,
		kind: "dynamic",
	},
	{
		id: "eyeshadow-girl-pink",
		category: "eyeshadow",
		titleZh: "少女粉",
		titleEn: "Girl pink",
		resourceId: "7408077631049960744",
		version: "1a234c85160694dd855f9cfe76a81145",
		parameterKey: "face_adjust_eyeshadow_shaonvfen",
		defaultIntensity: 80,
		kind: "dynamic",
	},
	{
		id: "contacts-natural",
		category: "contacts",
		titleZh: "原生",
		titleEn: "Natural",
		resourceId: "7406181207551069440",
		version: "8c4a50efd7b603235abbb1b315704e8d",
		parameterKey: "face_adjust_pupil_yuansheng",
		defaultIntensity: 80,
		kind: "dynamic",
	},
	{
		id: "highlight-sweetheart",
		category: "highlight",
		titleZh: "美式甜心",
		titleEn: "Sweetheart",
		resourceId: "7406175318072888576",
		version: "1fb1a0dfaaeadb313f4b3d3b96eaae0c",
		parameterKey: "face_adjust_highlight_meishitianxin",
		defaultIntensity: 70,
		kind: "dynamic",
	},
	{
		id: "freckles-sunburn",
		category: "freckles",
		titleZh: "晒伤",
		titleEn: "Sun kissed",
		resourceId: "7406174488410262784",
		version: "547119e40339154d17eb93c62ee9433b",
		parameterKey: "face_adjust_mask_jipusaiqueban",
		defaultIntensity: 50,
		kind: "dynamic",
	},
];

const MAKEUP_CARD_BY_ID = new Map<string, JianyingPortraitMakeupCardDefinition>(
	JIANYING_PORTRAIT_MAKEUP_CARDS.map((card) => [card.id, card])
);

export function jianyingPortraitMakeupCard({ id }: { id: string }) {
	return MAKEUP_CARD_BY_ID.get(id);
}

/** One face's worth of makeup intensity for parameter emission. */
export interface JianyingPortraitMakeupFaceEntry {
	id: number;
	intensity: number;
}

/** Standalone and dynamic makeup both match this id to the freid track id. */
export function buildJianyingStandaloneMakeupParameters({
	card,
	intensity,
	targetFaceId,
	faceEntries,
}: {
	card: JianyingPortraitMakeupCardDefinition;
	intensity: number;
	targetFaceId: number;
	faceEntries?: readonly JianyingPortraitMakeupFaceEntry[];
}) {
	const vector = [
		{
			id: targetFaceId,
			intensity: intensity / 100,
			...(card.id === "look-oxygen" ? { disable_part: [] } : {}),
		},
		...(faceEntries ?? []).map((entry) => ({
			id: entry.id,
			intensity: entry.intensity / 100,
			...(card.id === "look-oxygen" ? { disable_part: [] } : {}),
		})),
	];
	return JSON.stringify({ [card.parameterKey]: vector });
}

export function buildJianyingDynamicMakeupParameters({
	selections,
	targetFaceId,
}: {
	selections: Array<{
		card: JianyingPortraitMakeupCardDefinition;
		intensity: number;
		packagePath: string;
		faceEntries?: readonly JianyingPortraitMakeupFaceEntry[];
	}>;
	targetFaceId: number;
}) {
	return JSON.stringify(
		Object.fromEntries(
			selections.map(({ card, intensity, packagePath, faceEntries }) => [
				card.parameterKey,
				[
					{
						id: targetFaceId,
						intensity: intensity / 100,
						path: packagePath,
					},
					...(faceEntries ?? []).map((entry) => ({
						id: entry.id,
						intensity: entry.intensity / 100,
						path: packagePath,
					})),
				],
			])
		)
	);
}
