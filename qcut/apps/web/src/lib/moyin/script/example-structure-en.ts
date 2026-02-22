/**
 * Pre-parsed structure data for the English Basketball Girls example.
 * English translation of the original moyin-creator demo.
 *
 * 8 characters, 5 scenes, 1 episode, 49 shots.
 */

import type {
	Episode,
	ScriptCharacter,
	ScriptData,
	ScriptScene,
	Shot,
} from "@/types/moyin-script";
import { DEMO_IMAGES } from "./example-demo-images";

// ── Helper ──────────────────────────────────────────────────────────

function mkShot(
	index: number,
	sceneRefId: string,
	actionSummary: string,
	opts: {
		size?: string;
		dur?: number;
		chars?: string[];
		charIds?: string[];
		dialogue?: string;
		imageUrl?: string;
		endFrameImageUrl?: string;
	} = {}
): Shot {
	return {
		id: `ex_en_shot_${index + 1}`,
		index,
		sceneRefId,
		actionSummary,
		shotSize: opts.size,
		duration: opts.dur,
		characterNames: opts.chars,
		characterIds: opts.charIds ?? [],
		characterVariations: {},
		imageStatus: opts.imageUrl ? "completed" : "idle",
		imageProgress: opts.imageUrl ? 100 : 0,
		imageUrl: opts.imageUrl,
		endFrameImageUrl: opts.endFrameImageUrl,
		videoStatus: "idle",
		videoProgress: 0,
	};
}

const C = {
	sxq: "ex_en_char_1", // Shen Xingqing
	myh: "ex_en_char_2", // Ma Yihua
	zsn: "ex_en_char_3", // Zhao Sinan
	cml: "ex_en_char_4", // Chen Moli
	yxl: "ex_en_char_5", // Ye Xiaoling
	ln: "ex_en_char_6", // Liu Na
	cm: "ex_en_char_7", // Villager
	boy: "ex_en_char_8", // Boy
} as const;

// ── Characters ──────────────────────────────────────────────────────

export const EN_CHARACTERS: ScriptCharacter[] = [
	{
		id: C.myh,
		name: "Ma Yihua",
		gender: "Female",
		age: "17",
		role: "protagonist",
		personality:
			"Hotheaded class athletic rep and figurine fanatic. Tough, blunt, deeply insecure. Treats her NBA star figurine as a lifeline.",
		tags: ["protagonist"],
	},
	{
		id: C.sxq,
		name: "Shen Xingqing",
		gender: "Female",
		age: "22",
		role: "protagonist",
		personality:
			"Passionate volunteer teacher. Elite-university graduate, former provincial basketball team starter, rebellious and unconventional.",
		tags: ["protagonist"],
	},
	{
		id: C.zsn,
		name: "Zhao Sinan",
		gender: "Female",
		age: "18",
		role: "supporting",
		personality:
			'The held-back "wild child." Cold on the outside, fiercely loyal within. Extraordinary physical strength from years of farm work.',
		tags: ["supporting"],
	},
	{
		id: C.cml,
		name: "Chen Moli",
		gender: "Female",
		age: "17",
		role: "supporting",
		personality:
			'The drama queen "fence-sitter." Sharp-minded, precociously perceptive, skilled at playing dumb. Only plays basketball to fit in.',
		tags: ["supporting"],
	},
	{
		id: C.yxl,
		name: "Ye Xiaoling",
		gender: "Female",
		age: "17",
		role: "supporting",
		personality:
			"Acid-tongued bookworm. Proud, competitive, openly hostile toward rural life. Behind her cold exterior lies a photographic memory.",
		tags: ["supporting"],
	},
	{
		id: C.ln,
		name: "Liu Na",
		gender: "Female",
		age: "16",
		role: "supporting",
		personality:
			"The school tattletale. Timid, scarred by a family that favors boys. Hides behind her claim of being the dean's niece.",
		tags: ["supporting"],
	},
	{
		id: C.cm,
		name: "Villager",
		role: "minor",
		personality: "A passing villager who asks about the teaching assignment.",
		tags: ["minor"],
	},
	{
		id: C.boy,
		name: "Boy",
		gender: "Male",
		role: "minor",
		personality: "A troublemaking schoolboy who picks on Liu Na.",
		tags: ["minor"],
	},
];

// ── Scenes ──────────────────────────────────────────────────────────

export const EN_SCENES: ScriptScene[] = [
	{
		id: "ex_en_scene_1",
		name: "1-1 Rural Road / Bus",
		location: "Rural Road / Bus",
		time: "day",
		atmosphere: "Bumpy, dusty, drowsy with a hint of unease",
	},
	{
		id: "ex_en_scene_2",
		name: "1-2 School Basketball Court",
		location: "School Basketball Court",
		time: "day",
		atmosphere: "Scorching heat, crude facilities, absurd calm",
	},
	{
		id: "ex_en_scene_3",
		name: "1-3 Courtside Tree Shade",
		location: "Courtside Tree Shade",
		time: "day",
		atmosphere: "Lazy turning tense, latent conflict",
	},
	{
		id: "ex_en_scene_4",
		name: "1-4 Under the Basketball Hoop",
		location: "Under the Basketball Hoop",
		time: "day",
		atmosphere: "Shock, freeze-frame, tragic (played for comedy)",
	},
	{
		id: "ex_en_scene_5",
		name: "1-5 Center Court",
		location: "Center Court",
		time: "day",
		atmosphere: "Intense, wild, explosive conflict, dust flying",
	},
];

// ── Episodes ────────────────────────────────────────────────────────

export const EN_EPISODES: Episode[] = [
	{
		id: "ex_en_ep_1",
		index: 0,
		title: "Episode 1: Figurine Bloodshed",
		sceneIds: [
			"ex_en_scene_1",
			"ex_en_scene_2",
			"ex_en_scene_3",
			"ex_en_scene_4",
			"ex_en_scene_5",
		],
	},
];

// ── Shots (49 total) ────────────────────────────────────────────────

const S1 = "ex_en_scene_1";
const S2 = "ex_en_scene_2";
const S3 = "ex_en_scene_3";
const S4 = "ex_en_scene_4";
const S5 = "ex_en_scene_5";

export const EN_SHOTS: Shot[] = [
	// Scene 1: Rural Road / Bus (5 shots)
	mkShot(
		0,
		S1,
		"Battered bus lurches on mountain road, Xingqing dozes, suitcase slides open, basketball rolls out",
		{
			size: "MS",
			dur: 5,
			chars: ["Shen Xingqing"],
			charIds: [C.sxq],
			imageUrl: DEMO_IMAGES.shot0,
			endFrameImageUrl: DEMO_IMAGES.shot0EndFrame,
		}
	),
	mkShot(1, S1, "Villager speaks", {
		size: "CU",
		dur: 4,
		chars: ["Villager"],
		charIds: [C.cm],
		dialogue: "VILLAGER: (in thick dialect) Hey miss — here to teach?",
		imageUrl: DEMO_IMAGES.shot1,
	}),
	mkShot(2, S1, "Xingqing opens eyes, picks up ball, MVP letters worn smooth", {
		size: "MS",
		dur: 5,
		chars: ["Shen Xingqing"],
		charIds: [C.sxq],
		imageUrl: DEMO_IMAGES.shot2,
	}),
	mkShot(3, S1, "Xingqing replies", {
		size: "CU",
		dur: 3,
		chars: ["Shen Xingqing"],
		charIds: [C.sxq],
		dialogue: "XINGQING: Here for grad-school credits.",
		imageUrl: DEMO_IMAGES.shot3,
	}),
	mkShot(
		4,
		S1,
		"She stuffs ball back, stares out window. TITLE CARD: Hunan — Qingshi Town",
		{
			size: "MS",
			dur: 4,
			imageUrl: DEMO_IMAGES.shot4,
		}
	),

	// Scene 2: School Basketball Court (6 shots)
	mkShot(
		5,
		S2,
		"Concrete court baking in sun, Yihua places figurine on hoop base",
		{
			size: "MS",
			dur: 5,
			chars: ["Ma Yihua"],
			charIds: [C.myh],
		}
	),
	mkShot(6, S2, "Yihua speaks", {
		size: "CU",
		dur: 4,
		chars: ["Ma Yihua"],
		charIds: [C.myh],
		dialogue: "YIHUA: Bless me, babe. Fifty-percent shooting today — minimum.",
	}),
	mkShot(7, S2, "Moli speaks", {
		size: "CU",
		dur: 6,
		chars: ["Chen Moli"],
		charIds: [C.cml],
		dialogue:
			"MOLI: (holding compact mirror, reapplying sunscreen) Yihua, this sun could peel paint off a wall. Your figurine's going to melt.",
	}),
	mkShot(8, S2, "Xiaoling speaks", {
		size: "MS",
		dur: 6,
		chars: ["Ye Xiaoling"],
		charIds: [C.yxl],
		dialogue:
			"XIAOLING: (flipping through vocabulary book) Given the UV index, the model's paint will undergo irreversible fading within two hours. Yihua, this is childish.",
	}),
	mkShot(9, S2, "Yihua dribbles and speaks", {
		size: "MS",
		dur: 5,
		chars: ["Ma Yihua"],
		charIds: [C.myh],
		dialogue:
			"YIHUA: (dribbling, crisp crossover) Shut up! This is called a spiritual anchor! I'll show you what a city-league fadeaway looks like!",
	}),
	mkShot(10, S2, "Yihua jumps, shoots, ball clangs off rim toward grass", {
		size: "MS",
		dur: 3,
		chars: ["Ma Yihua"],
		charIds: [C.myh],
	}),

	// Scene 3: Courtside Tree Shade (7 shots)
	mkShot(
		11,
		S3,
		"Sinan lies in grass under tree, boys circle Liu Na tossing her backpack",
		{
			size: "LS",
			dur: 5,
			chars: ["Zhao Sinan", "Liu Na"],
			charIds: [C.zsn, C.ln],
		}
	),
	mkShot(12, S3, "Liu Na speaks", {
		size: "CU",
		dur: 4,
		chars: ["Liu Na"],
		charIds: [C.ln],
		dialogue:
			"LIU NA: Give it back! I swear I'll tell my uncle — I'll tell the dean!",
	}),
	mkShot(13, S3, "Boy speaks", {
		size: "CU",
		dur: 4,
		chars: ["Boy"],
		charIds: [C.boy],
		dialogue:
			"BOY: Go ahead! Fake niece! Where's your held-back cousin? Tell her to come out!",
	}),
	mkShot(
		14,
		S3,
		"Basketball slams at boy's feet, Sinan sits up, wolf-cold eyes",
		{
			size: "MS",
			dur: 4,
			chars: ["Zhao Sinan"],
			charIds: [C.zsn],
		}
	),
	mkShot(15, S3, "Sinan speaks", {
		size: "CU",
		dur: 4,
		chars: ["Zhao Sinan"],
		charIds: [C.zsn],
		dialogue: "SINAN: Ball. Pick it up.",
	}),
	mkShot(
		16,
		S3,
		"Boys scatter, Liu Na snatches basketball and tosses it behind her",
		{
			size: "MS",
			dur: 5,
			chars: ["Zhao Sinan", "Liu Na"],
			charIds: [C.zsn, C.ln],
		}
	),
	mkShot(17, S3, "Liu Na speaks", {
		size: "CU",
		dur: 4,
		chars: ["Liu Na"],
		charIds: [C.ln],
		dialogue: "LIU NA: Who just throws a ball around? No manners!",
	}),

	// Scene 4: Under the Basketball Hoop (12 shots)
	mkShot(
		18,
		S4,
		"Basketball smashes into hoop base, figurine snaps apart, head rolls",
		{
			size: "MS",
			dur: 6,
		}
	),
	mkShot(19, S4, "Yihua freezes, world stops for three seconds", {
		size: "MS",
		dur: 4,
		chars: ["Ma Yihua"],
		charIds: [C.myh],
	}),
	mkShot(20, S4, "Yihua screams", {
		size: "CU",
		dur: 3,
		chars: ["Ma Yihua"],
		charIds: [C.myh],
		dialogue: "YIHUA: (screaming) MY BABY—!",
	}),
	mkShot(21, S4, "She lunges for decapitated figurine, eyes instantly red", {
		size: "MS",
		dur: 4,
	}),
	mkShot(22, S4, "Yihua points at Liu Na", {
		size: "CU",
		dur: 4,
		chars: ["Ma Yihua"],
		charIds: [C.myh],
		dialogue:
			"YIHUA: (pointing at Liu Na) You're paying for this! This is a limited edition!",
	}),
	mkShot(23, S4, "Liu Na scrambles behind Sinan", {
		size: "CU",
		dur: 5,
		chars: ["Liu Na"],
		charIds: [C.ln],
		dialogue:
			"LIU NA: (scrambling behind Sinan) Who told you to put a toy there? This is a basketball court!",
	}),
	mkShot(24, S4, "Moli snaps mirror shut", {
		size: "CU",
		dur: 6,
		chars: ["Chen Moli"],
		charIds: [C.cml],
		dialogue:
			"MOLI: (snapping mirror shut) Oh, so you break someone's stuff and cop an attitude? Don't think your last name buys you connections.",
	}),
	mkShot(25, S4, "Xiaoling walks over ice-cold", {
		size: "MS",
		dur: 5,
		chars: ["Ye Xiaoling", "Ma Yihua"],
		charIds: [C.yxl, C.myh],
		dialogue:
			"XIAOLING: (closing book, ice-cold) Intentional destruction of property exceeding 500 yuan is a police matter. Yihua, make her pay.",
	}),
	mkShot(
		26,
		S4,
		"Sinan steps in front of Liu Na, half a head taller than Yihua",
		{
			size: "MS",
			dur: 4,
			chars: ["Ma Yihua", "Zhao Sinan", "Liu Na"],
			charIds: [C.myh, C.zsn, C.ln],
		}
	),
	mkShot(27, S4, "Sinan speaks", {
		size: "CU",
		dur: 4,
		chars: ["Zhao Sinan"],
		charIds: [C.zsn],
		dialogue:
			"SINAN: My sister threw the ball. You want money? Don't have any.",
	}),
	mkShot(28, S4, "Yihua demands", {
		size: "CU",
		dur: 5,
		chars: ["Ma Yihua"],
		charIds: [C.myh],
		dialogue: "YIHUA: No money? Then get on your knees and apologize to it!",
	}),
	mkShot(29, S4, "Yihua shoves Sinan, Sinan doesn't budge", {
		size: "MS",
		dur: 3,
		chars: ["Ma Yihua", "Zhao Sinan"],
		charIds: [C.myh, C.zsn],
	}),

	// Scene 5: Center Court (19 shots)
	mkShot(30, S5, "Yihua hurls basketball at Sinan, Sinan catches one-handed", {
		size: "MS",
		dur: 5,
		chars: ["Ma Yihua", "Zhao Sinan"],
		charIds: [C.myh, C.zsn],
	}),
	mkShot(31, S5, "Sinan speaks", {
		size: "CU",
		dur: 4,
		chars: ["Zhao Sinan"],
		charIds: [C.zsn],
		dialogue: "SINAN: Save your energy. You'll need it for farm work.",
	}),
	mkShot(
		32,
		S5,
		"Sinan dribbles with terrible form but blinding speed, charges basket, Yihua bounces off",
		{
			size: "MS",
			dur: 6,
			chars: ["Ma Yihua", "Zhao Sinan"],
			charIds: [C.myh, C.zsn],
		}
	),
	mkShot(
		33,
		S5,
		"Sinan leaps, slams ball at rim, too much force, ball rockets skyward",
		{
			size: "MS",
			dur: 4,
			chars: ["Zhao Sinan"],
			charIds: [C.zsn],
		}
	),
	mkShot(34, S5, "Xingqing appears, catches falling ball", {
		size: "CU",
		dur: 5,
		chars: ["Shen Xingqing"],
		charIds: [C.sxq],
		dialogue:
			"XINGQING: (catching the falling ball) Terrible form. But the explosiveness — not bad.",
	}),
	mkShot(
		35,
		S5,
		"Everyone freezes. Xingqing in white T-shirt, bicycle behind her",
		{
			size: "MS",
			dur: 4,
			chars: ["Shen Xingqing"],
			charIds: [C.sxq],
		}
	),
	mkShot(36, S5, "Xingqing introduces herself", {
		size: "CU",
		dur: 3,
		chars: ["Shen Xingqing"],
		charIds: [C.sxq],
		dialogue: "XINGQING: I'm the new PE teacher.",
	}),
	mkShot(37, S5, "Yihua protests, wiping tears", {
		size: "CU",
		dur: 5,
		chars: ["Ma Yihua"],
		charIds: [C.myh],
		dialogue:
			"YIHUA: (wiping tears, defiant) Teacher? She wrecked my figurine!",
	}),
	mkShot(38, S5, "Xingqing questions their methods", {
		size: "CU",
		dur: 4,
		chars: ["Shen Xingqing"],
		charIds: [C.sxq],
		dialogue:
			"XINGQING: I can see that. So the only way you people solve problems here is fighting?",
	}),
	mkShot(39, S5, "Xingqing looks at Yihua, then at Sinan", {
		size: "MS",
		dur: 5,
		chars: ["Ma Yihua", "Shen Xingqing", "Zhao Sinan"],
		charIds: [C.myh, C.sxq, C.zsn],
	}),
	mkShot(40, S5, "Xingqing proposes three-on-three", {
		size: "CU",
		dur: 4,
		chars: ["Shen Xingqing"],
		charIds: [C.sxq],
		dialogue:
			"XINGQING: Alright. Since you both think you're tough. Three on three.",
	}),
	mkShot(41, S5, "Xingqing points at Sinan", {
		size: "CU",
		dur: 3,
		chars: ["Shen Xingqing"],
		charIds: [C.sxq],
		dialogue: "XINGQING: (pointing at Sinan) You — go find two more.",
	}),
	mkShot(42, S5, "Xingqing looks at Yihua", {
		size: "CU",
		dur: 5,
		chars: ["Shen Xingqing"],
		charIds: [C.sxq],
		dialogue:
			'XINGQING: (looking at Yihua) You three — don\'t embarrass the "city girls" reputation.',
	}),
	mkShot(43, S5, "Xingqing announces the stakes", {
		size: "MS",
		dur: 6,
		chars: ["Shen Xingqing"],
		charIds: [C.sxq],
		dialogue:
			"XINGQING: Losers wash all the school's sports equipment for a month. And the losing side apologizes. Publicly.",
	}),
	mkShot(44, S5, "Yihua accepts through gritted teeth", {
		size: "CU",
		dur: 4,
		chars: ["Ma Yihua"],
		charIds: [C.myh],
		dialogue:
			"YIHUA: (through gritted teeth) Fine! You think I'm scared of you hicks?",
	}),
	mkShot(45, S5, "Sinan responds flatly", {
		size: "CU",
		dur: 3,
		chars: ["Zhao Sinan"],
		charIds: [C.zsn],
		dialogue: "SINAN: (flat) Whatever.",
	}),
	mkShot(46, S5, "Xingqing tosses ball to Yihua, sly smile", {
		size: "MS",
		dur: 4,
		chars: ["Ma Yihua", "Shen Xingqing"],
		charIds: [C.myh, C.sxq],
	}),
	mkShot(47, S5, "Xingqing sets the time", {
		size: "CU",
		dur: 4,
		chars: ["Shen Xingqing"],
		charIds: [C.sxq],
		dialogue: "XINGQING: Tomorrow afternoon. This hoop.",
	}),
	mkShot(
		48,
		S5,
		"TITLE CARD: Qingshi Town Middle School — First Game: 24 Hours",
		{
			size: "WS",
			dur: 3,
		}
	),
];

// ── ScriptData ──────────────────────────────────────────────────────

export const EN_SCRIPT_DATA: ScriptData = {
	title: "Basketball Girls",
	genre: "Campus Drama",
	logline:
		"Three teenage girls, banished from big-city life back to a remote Hunan village after family upheavals, carry their urban pride and quiet desperation into a crumbling rural middle school. When city-league basketball skills meet raw village strength — and a prized collectible figurine shatters in the crossfire — these outcasts decide that on a dust-choked concrete court, one basketball can win back the dignity the world took from them.",
	language: "English",
	characters: EN_CHARACTERS,
	scenes: EN_SCENES,
	episodes: EN_EPISODES,
	storyParagraphs: [],
};
