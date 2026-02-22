/**
 * Pre-parsed structure data for the Chinese Basketball Girls (灌篮少女) example.
 * Extracted from the original moyin-creator demo data.
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
		id: `ex_zh_shot_${index + 1}`,
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

// Name → ID lookup (corrected from original demo where characterIds were wrong)
const C = {
	sxq: "ex_zh_char_1", // 沈星晴
	myh: "ex_zh_char_2", // 马一花
	zsn: "ex_zh_char_3", // 赵思楠
	cml: "ex_zh_char_4", // 陈茉莉
	yxl: "ex_zh_char_5", // 叶小玲
	ln: "ex_zh_char_6", // 刘娜
	cm: "ex_zh_char_7", // 村民
	boy: "ex_zh_char_8", // 男同学
} as const;

// ── Characters ──────────────────────────────────────────────────────

export const ZH_CHARACTERS: ScriptCharacter[] = [
	{
		id: C.myh,
		name: "马一花",
		gender: "女",
		age: "17",
		role: "protagonist",
		personality:
			"暴躁体委/手办狂魔。强悍直率，极度缺乏安全感，视球星手办为命根。",
		tags: ["protagonist"],
	},
	{
		id: C.sxq,
		name: "沈星晴",
		gender: "女",
		age: "22",
		role: "protagonist",
		personality: "热血支教老师。名牌大学毕业生，前篮球队主力，叛逆不羁。",
		tags: ["protagonist"],
	},
	{
		id: C.zsn,
		name: "赵思楠",
		gender: "女",
		age: "18",
		role: "supporting",
		personality:
			"留级“野孩子”。外冷内热，身体素质极佳，视刘娜为唯一的守护对象。",
		tags: ["supporting"],
	},
	{
		id: C.cml,
		name: "陈茉莉",
		gender: "女",
		age: "17",
		role: "supporting",
		personality:
			"戏精“墙头草”。心思缜密，早熟敏感，擅长装傻充愣，打球只为合群。",
		tags: ["supporting"],
	},
	{
		id: C.yxl,
		name: "叶小玲",
		gender: "女",
		age: "17",
		role: "supporting",
		personality: "毒舌学霸。心高气傲，事事要强，对乡村环境充满抵触。",
		tags: ["supporting"],
	},
	{
		id: C.ln,
		name: "刘娜",
		gender: "女",
		age: "16",
		role: "supporting",
		personality: "告状小能手。胆小且重男轻女家庭受害者，虚张声势的“主任侄女”。",
		tags: ["supporting"],
	},
	{
		id: C.cm,
		name: "村民",
		role: "minor",
		personality: "路过的村民，询问支教情况。",
		tags: ["minor"],
	},
	{
		id: C.boy,
		name: "男同学",
		gender: "男",
		role: "minor",
		personality: "学校男同学，与刘娜发生口角。",
		tags: ["minor"],
	},
];

// ── Scenes ──────────────────────────────────────────────────────────

export const ZH_SCENES: ScriptScene[] = [
	{
		id: "ex_zh_scene_1",
		name: "1-1 乡村公路/大巴车",
		location: "乡村公路/大巴车",
		time: "day",
		atmosphere: "颠簸、尘土飞扬、沉闷中带着一丝不安",
	},
	{
		id: "ex_zh_scene_2",
		name: "1-2 中学操场",
		location: "中学操场",
		time: "day",
		atmosphere: "暴晒、炎热、简陋、宁静中透着荒诞",
	},
	{
		id: "ex_zh_scene_3",
		name: "1-3 操场边缘树荫",
		location: "操场边缘树荫",
		time: "day",
		atmosphere: "慵懒转为紧张，潜藏的冲突感",
	},
	{
		id: "ex_zh_scene_4",
		name: "1-4 操场篮球架下",
		location: "操场篮球架下",
		time: "day",
		atmosphere: "震惊、静止、悲剧性（喜剧化处理）",
	},
	{
		id: "ex_zh_scene_5",
		name: "1-5 操场中央",
		location: "操场中央",
		time: "day",
		atmosphere: "激烈、充满野性、冲突爆发、尘土飞扬",
	},
];

// ── Episodes ────────────────────────────────────────────────────────

export const ZH_EPISODES: Episode[] = [
	{
		id: "ex_zh_ep_1",
		index: 0,
		title: "第1集：手办血案",
		sceneIds: [
			"ex_zh_scene_1",
			"ex_zh_scene_2",
			"ex_zh_scene_3",
			"ex_zh_scene_4",
			"ex_zh_scene_5",
		],
	},
];

// ── Shots (49 total) ────────────────────────────────────────────────

const S1 = "ex_zh_scene_1";
const S2 = "ex_zh_scene_2";
const S3 = "ex_zh_scene_3";
const S4 = "ex_zh_scene_4";
const S5 = "ex_zh_scene_5";

export const ZH_SHOTS: Shot[] = [
	// Scene 1: 乡村公路/大巴车 (5 shots)
	mkShot(0, S1, "破旧大巴车颠簸，沈星晴睡觉，行李箱滑开，篮球滚出", {
		size: "MS",
		dur: 5,
		chars: ["沈星晴"],
		charIds: [C.sxq],
		imageUrl: DEMO_IMAGES.shot0,
		endFrameImageUrl: DEMO_IMAGES.shot0EndFrame,
	}),
	mkShot(1, S1, "村民说话", {
		size: "CU",
		dur: 4,
		chars: ["村民"],
		charIds: [C.cm],
		dialogue: "村民（操着方言）：妹子，支教的？",
		imageUrl: DEMO_IMAGES.shot1,
	}),
	mkShot(2, S1, "沈星晴睁眼，捡球，球面“MVP”字样已磨损", {
		size: "MS",
		dur: 5,
		chars: ["沈星晴"],
		charIds: [C.sxq],
		imageUrl: DEMO_IMAGES.shot2,
	}),
	mkShot(3, S1, "沈星晴说话", {
		size: "CU",
		dur: 3,
		chars: ["沈星晴"],
		charIds: [C.sxq],
		dialogue: "沈星晴：来保研的。",
		imageUrl: DEMO_IMAGES.shot3,
	}),
	mkShot(4, S1, "她把球塞回包里，看向窗外。字幕：湖南 · 青石镇", {
		size: "MS",
		dur: 4,
		imageUrl: DEMO_IMAGES.shot4,
	}),

	// Scene 2: 中学操场 (6 shots)
	mkShot(5, S2, "水泥地操场，马一花把球星手办放在篮球架底座上", {
		size: "MS",
		dur: 5,
		chars: ["马一花"],
		charIds: [C.myh],
	}),
	mkShot(6, S2, "马一花说话", {
		size: "CU",
		dur: 4,
		chars: ["马一花"],
		charIds: [C.myh],
		dialogue: "马一花：老公保佑，今天投篮命中率必须过五十。",
	}),
	mkShot(7, S2, "陈茉莉说话", {
		size: "CU",
		dur: 6,
		chars: ["陈茉莉"],
		charIds: [C.cml],
		dialogue:
			"陈茉莉（拿着小镜子补防晒）：一花，这地儿太阳毒得能脱皮，你那手办都要晒化了。",
	}),
	mkShot(8, S2, "叶小玲说话", {
		size: "MS",
		dur: 6,
		chars: ["叶小玲"],
		charIds: [C.yxl],
		dialogue:
			"叶小玲（靠在架子旁翻英语单词手册）：根据紫外线强度，该模型涂料在两小时内会发生不可逆的褪色。马一花，你的行为很幼稚。",
	}),
	mkShot(9, S2, "马一花运球说话", {
		size: "MS",
		dur: 5,
		chars: ["马一花"],
		charIds: [C.myh],
		dialogue: "马一花（运球）：闭嘴！这叫精神支柱！给你们展示城市联赛级后仰！",
	}),
	mkShot(10, S2, "马一花起跳投篮，篮球弹向草丛", {
		size: "MS",
		dur: 3,
		chars: ["马一花"],
		charIds: [C.myh],
	}),

	// Scene 3: 操场边缘树荫 (7 shots)
	mkShot(11, S3, "赵思楠躺草地闭目养神，刘娜被男生围着抢书包", {
		size: "LS",
		dur: 5,
		chars: ["赵思楠", "刘娜"],
		charIds: [C.zsn, C.ln],
	}),
	mkShot(12, S3, "刘娜说话", {
		size: "CU",
		dur: 4,
		chars: ["刘娜"],
		charIds: [C.ln],
		dialogue: "刘娜：还给我！信不信我告诉我叔……告教导主任去！",
	}),
	mkShot(13, S3, "男同学说话", {
		size: "CU",
		dur: 4,
		chars: ["男同学"],
		charIds: [C.boy],
		dialogue: "男同学：告啊！假侄女！你那个留级生表姐呢？让她出来啊！",
	}),
	mkShot(14, S3, "篮球砸在男生脚下，赵思楠坐起身，眼神像狼", {
		size: "MS",
		dur: 4,
		chars: ["赵思楠"],
		charIds: [C.zsn],
	}),
	mkShot(15, S3, "赵思楠说话", {
		size: "CU",
		dur: 4,
		chars: ["赵思楠"],
		charIds: [C.zsn],
		dialogue: "赵思楠：球，捡起来。",
	}),
	mkShot(16, S3, "男生被赵思楠气场震住散去，刘娜捡球往后一抛", {
		size: "MS",
		dur: 5,
		chars: ["赵思楠", "刘娜"],
		charIds: [C.zsn, C.ln],
	}),
	mkShot(17, S3, "刘娜说话", {
		size: "CU",
		dur: 4,
		chars: ["刘娜"],
		charIds: [C.ln],
		dialogue: "刘娜：谁乱扔球啊！没素质！",
	}),

	// Scene 4: 操场篮球架下 (12 shots)
	mkShot(18, S4, "篮球砸中手办，手办断裂，头滚落地面", {
		size: "MS",
		dur: 6,
	}),
	mkShot(19, S4, "马一花僵在原地，世界静止三秒", {
		size: "MS",
		dur: 4,
		chars: ["马一花"],
		charIds: [C.myh],
	}),
	mkShot(20, S4, "马一花爆发尖叫", {
		size: "CU",
		dur: 3,
		chars: ["马一花"],
		charIds: [C.myh],
		dialogue: "马一花（爆发尖叫）：我的老公——！",
	}),
	mkShot(21, S4, "她疯了一样冲去捡断头手办，眼眶瞬间红了", {
		size: "MS",
		dur: 4,
	}),
	mkShot(22, S4, "马一花指向刘娜说话", {
		size: "CU",
		dur: 4,
		chars: ["马一花"],
		charIds: [C.myh],
		dialogue: "马一花（指向刘娜）：你赔！你知不知道这是绝版！",
	}),
	mkShot(23, S4, "刘娜吓得钻赵思楠身后说话", {
		size: "CU",
		dur: 5,
		chars: ["刘娜"],
		charIds: [C.ln],
		dialogue:
			"刘娜（吓得钻赵思楠身后）：谁让你把玩具放那儿的……这、这儿是操场！",
	}),
	mkShot(24, S4, "陈茉莉收起镜子说话", {
		size: "CU",
		dur: 6,
		chars: ["陈茉莉"],
		charIds: [C.cml],
		dialogue: "陈茉莉（收起镜子）：弄坏了东西还挺横？别以为你姓刘就有后台。",
	}),
	mkShot(25, S4, "叶小玲合上书冷冷走过来说话", {
		size: "MS",
		dur: 5,
		chars: ["叶小玲", "马一花"],
		charIds: [C.yxl, C.myh],
		dialogue:
			"叶小玲（合上书）：故意损坏他人财物，金额超过五百元可以报案。马一花，别废话，让她赔。",
	}),
	mkShot(26, S4, "赵思楠挡在刘娜身前，比马一花高半个头", {
		size: "MS",
		dur: 4,
		chars: ["马一花", "赵思楠", "刘娜"],
		charIds: [C.myh, C.zsn, C.ln],
	}),
	mkShot(27, S4, "赵思楠说话", {
		size: "CU",
		dur: 4,
		chars: ["赵思楠"],
		charIds: [C.zsn],
		dialogue: "赵思楠：球是我妹扔的，想要钱，没有。",
	}),
	mkShot(28, S4, "马一花说话", {
		size: "CU",
		dur: 5,
		chars: ["马一花"],
		charIds: [C.myh],
		dialogue: "马一花：没钱？没钱你给我跪下给它道歉！",
	}),
	mkShot(29, S4, "马一花推搡赵思楠，赵思楠纹丝不动", {
		size: "MS",
		dur: 3,
		chars: ["马一花", "赵思楠"],
		charIds: [C.myh, C.zsn],
	}),

	// Scene 5: 操场中央 (19 shots)
	mkShot(30, S5, "马一花抡篮球砸赵思楠，赵思楠单手挡住", {
		size: "MS",
		dur: 5,
		chars: ["马一花", "赵思楠"],
		charIds: [C.myh, C.zsn],
	}),
	mkShot(31, S5, "赵思楠说话", {
		size: "CU",
		dur: 4,
		chars: ["赵思楠"],
		charIds: [C.zsn],
		dialogue: "赵思楠：有力气，留着干活。",
	}),
	mkShot(32, S5, "赵思楠运球冲篮下，马一花拦截被弹开", {
		size: "MS",
		dur: 6,
		chars: ["马一花", "赵思楠"],
		charIds: [C.myh, C.zsn],
	}),
	mkShot(33, S5, "赵思楠跳起砸向篮筐，球弹得老高", {
		size: "MS",
		dur: 4,
		chars: ["赵思楠"],
		charIds: [C.zsn],
	}),
	mkShot(34, S5, "沈星晴突然出现接球说话", {
		size: "CU",
		dur: 5,
		chars: ["沈星晴"],
		charIds: [C.sxq],
		dialogue: "沈星晴（突然出现接球）：姿势不及格，但爆发力不错。",
	}),
	mkShot(35, S5, "众人愣住。沈星晴穿白T恤骑共享单车到来", {
		size: "MS",
		dur: 4,
		chars: ["沈星晴"],
		charIds: [C.sxq],
	}),
	mkShot(36, S5, "沈星晴自我介绍", {
		size: "CU",
		dur: 3,
		chars: ["沈星晴"],
		charIds: [C.sxq],
		dialogue: "沈星晴：我是新来的体育老师。",
	}),
	mkShot(37, S5, "马一花抹眼泪不服气说话", {
		size: "CU",
		dur: 5,
		chars: ["马一花"],
		charIds: [C.myh],
		dialogue: "马一花（抹眼泪不服气）：老师？她弄坏了我的手办！",
	}),
	mkShot(38, S5, "沈星晴反问", {
		size: "CU",
		dur: 4,
		chars: ["沈星晴"],
		charIds: [C.sxq],
		dialogue: "沈星晴：我看出来了，你们这儿解决问题的方式只有打架？",
	}),
	mkShot(39, S5, "沈星晴看向马一花又看向赵思楠", {
		size: "MS",
		dur: 5,
		chars: ["马一花", "沈星晴", "赵思楠"],
		charIds: [C.myh, C.sxq, C.zsn],
	}),
	mkShot(40, S5, "沈星晴提出三对三", {
		size: "CU",
		dur: 4,
		chars: ["沈星晴"],
		charIds: [C.sxq],
		dialogue: "沈星晴：这样，既然都觉得自己厉害。三对三。",
	}),
	mkShot(41, S5, "沈星晴指向赵思楠", {
		size: "CU",
		dur: 3,
		chars: ["沈星晴"],
		charIds: [C.sxq],
		dialogue: "沈星晴（指向赵思楠）：你，去拉两个人。",
	}),
	mkShot(42, S5, "沈星晴看向马一花说话", {
		size: "CU",
		dur: 5,
		chars: ["沈星晴"],
		charIds: [C.sxq],
		dialogue: "沈星晴（看向马一花）：你们三个，别顶着“城里回来的”名号丢人。",
	}),
	mkShot(43, S5, "沈星晴宣布赌注", {
		size: "MS",
		dur: 6,
		chars: ["沈星晴"],
		charIds: [C.sxq],
		dialogue:
			"沈星晴：谁输了，谁负责洗全校一个月的体育器材，并且，输的那方要公开道歉。",
	}),
	mkShot(44, S5, "马一花咬牙应战", {
		size: "CU",
		dur: 4,
		chars: ["马一花"],
		charIds: [C.myh],
		dialogue: "马一花（咬牙）：打就打！怕你这个乡巴佬？",
	}),
	mkShot(45, S5, "赵思楠冷漠回应", {
		size: "CU",
		dur: 3,
		chars: ["赵思楠"],
		charIds: [C.zsn],
		dialogue: "赵思楠（冷漠）：随你。",
	}),
	mkShot(46, S5, "沈星晴把球扔给马一花，嘴角勾起玩味的笑", {
		size: "MS",
		dur: 4,
		chars: ["马一花", "沈星晴"],
		charIds: [C.myh, C.sxq],
	}),
	mkShot(47, S5, "沈星晴宣布比赛时间", {
		size: "CU",
		dur: 4,
		chars: ["沈星晴"],
		charIds: [C.sxq],
		dialogue: "沈星晴：明天下午，这个框。",
	}),
	mkShot(48, S5, "字幕：青石镇中学 · 篮球赛首战 倒计时24小时", {
		size: "WS",
		dur: 3,
	}),
];

// ── ScriptData ──────────────────────────────────────────────────────

export const ZH_SCRIPT_DATA: ScriptData = {
	title: "灌篮少女",
	genre: "校园",
	logline:
		"三个因家庭变故从大城市“流放”回湖南山村的少女，带着格格不入的傲气与失落，意外撞上了一心想保研的“刺头”女老师。当都市篮球技术遇见乡村野路子怪力，在破碎手办引发的冲突中，这群被生活放逐的少女决定在尘土飞扬的操场上，用一颗篮球赢回属于自己的尊严。",
	language: "中文",
	characters: ZH_CHARACTERS,
	scenes: ZH_SCENES,
	episodes: ZH_EPISODES,
	storyParagraphs: [],
};
