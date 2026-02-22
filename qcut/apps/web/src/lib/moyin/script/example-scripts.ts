/**
 * Example scripts for the Moyin script editor.
 * Based on the original 灌篮少女 (Basketball Girls) demo from moyin-creator.
 *
 * Users can load these via the "Load Example" button in the Import tab.
 * Each example includes pre-parsed structure data so the structure panel
 * populates immediately without requiring an API call.
 */

import type {
	Episode,
	ScriptCharacter,
	ScriptData,
	ScriptScene,
	Shot,
} from "@/types/moyin-script";
import {
	ZH_SCRIPT_DATA,
	ZH_CHARACTERS,
	ZH_SCENES,
	ZH_EPISODES,
	ZH_SHOTS,
} from "./example-structure-zh";
import {
	EN_SCRIPT_DATA,
	EN_CHARACTERS,
	EN_SCENES,
	EN_EPISODES,
	EN_SHOTS,
} from "./example-structure-en";

export interface ExampleScriptStructure {
	scriptData: ScriptData;
	characters: ScriptCharacter[];
	scenes: ScriptScene[];
	episodes: Episode[];
	shots: Shot[];
}

export interface ExampleScript {
	id: string;
	label: string;
	language: string;
	description: string;
	content: string;
	structure: ExampleScriptStructure;
}

export const EXAMPLE_SCRIPTS: ExampleScript[] = [
	{
		id: "basketball-girls-zh",
		label: "灌篮少女 (中文)",
		language: "中文",
		description: "Campus basketball drama — 8 characters, 5 scenes, 49 shots",
		structure: {
			scriptData: ZH_SCRIPT_DATA,
			characters: ZH_CHARACTERS,
			scenes: ZH_SCENES,
			episodes: ZH_EPISODES,
			shots: ZH_SHOTS,
		},
		content: `《灌篮少女》

大纲： 三个因家庭变故从大城市"流放"回湖南山村的少女，带着格格不入的傲气与失落，意外撞上了一心想保研的"刺头"女老师。当都市篮球技术遇见乡村野路子怪力，在破碎手办引发的冲突中，这群被生活放逐的少女决定在尘土飞扬的操场上，用一颗篮球赢回属于自己的尊严。

人物小传：
马一花（17）： 暴躁体委/手办狂魔。强悍直率，极度缺乏安全感，视球星手办为命根。
陈茉莉（17）： 戏精"墙头草"。心思缜密，早熟敏感，擅长装傻充愣，打球只为合群。
叶小玲（17）： 毒舌学霸。心高气傲，事事要强，对乡村环境充满抵触。
沈星晴（22）： 热血支教老师。名牌大学毕业生，前篮球队主力，叛逆不羁。
赵思楠（18）： 留级"野孩子"。外冷内热，身体素质极佳，视刘娜为唯一的守护对象。
刘娜（16）： 告状小能手。胆小且重男轻女家庭受害者，虚张声势的"主任侄女"。

第一集：手办血案

1-1 日 外 乡村公路/大巴车
人物：沈星晴、村民

△一辆破旧的大巴车在蜿蜒的山路上剧烈颠簸。窗外是连绵的梯田。
△沈星晴靠在椅背上睡觉，一记重响，她的行李箱滑开，一颗橘色的篮球滚到了过道中间。

村民：（操着方言）妹子，支教的？

△沈星晴睁眼，眼神里透着一丝冷淡的英气。她起身捡球，球面上"MVP"的字样已经磨损。

沈星晴：来保研的。

△她把球塞回包里，看向窗外。
【字幕：湖南 · 青石镇】

1-2 日 外 中学操场
人物：马一花、陈茉莉、叶小玲

△水泥地操场，篮板是木头做的，边缘已经开裂。
△马一花小心翼翼地把一个精美的NBA球星手办放在篮球架的底座上，还垫了一张干净的纸巾。

马一花：老公保佑，今天投篮命中率必须过五十。

陈茉莉：（拿着小镜子补防晒）一花，这地儿太阳毒得能脱皮，你那手办都要晒化了。

叶小玲：（靠在架子旁翻英语单词手册）根据紫外线强度，该模型涂料在两小时内会发生不可逆的褪色。马一花，你的行为很幼稚。

马一花：（运球，动作利落）闭嘴！这叫精神支柱！看好了，给你们这群土包子展示一下什么叫城市联赛级后仰！

△马一花起跳，投篮。篮球在铁框上弹了一下，飞向操场边的草丛。

1-3 日 外 操场边缘树荫
人物：赵思楠、刘娜、几个捣乱的男同学

△赵思楠枕着胳膊躺在草地上闭目养神，草帽盖在脸上。
△刘娜正被几个男生围着，书包被抢来抢去。

刘娜：还给我！信不信我告诉我叔……告教导主任去！

男同学：告啊！假侄女！你那个留级生表姐呢？让她出来啊！

△篮球"砰"地一声砸在男生脚下。
△草帽被掀开，赵思楠坐起身，眼神像狼一样冷。

赵思楠：球，捡起来。

△男生们对视一眼，被赵思楠的气场震住，丢下书包一哄而散。
△刘娜赶紧捡起球，顺手往后一抛。

刘娜：谁乱扔球啊！没素质！

1-4 日 外 操场篮球架下
人物：前场所有人

△篮球划出一道歪歪扭扭的弧线，精准地砸在篮球架底座上。
△"啪嗒"一声，那个球星手办被球砸中，整流罩断裂，头滚到了水泥地上。

△马一花僵在原地，世界静止了三秒。

马一花：（爆发出尖叫）我的老公——！

△她疯了一样冲过去捡起断头的手办，眼眶瞬间红了。

马一花：（指向刘娜）你赔！你知不知道这是绝版！

刘娜：（吓得往赵思楠身后钻）谁让你把玩具放那儿的……这、这儿是操场！

陈茉莉：（收起镜子，声音尖利）哎哟，弄坏了东西还挺横？别以为你姓刘就有后台。

叶小玲：（合上书，冷冷地走过来）故意损坏他人财物，金额超过五百元可以报案。马一花，别废话，让她赔。

△赵思楠挡在刘娜身前，个头比马一花还高半个头，浑身透着一股常年干农活的爆发力。

赵思楠：球是我妹扔的，想要钱，没有。

马一花：没钱？没钱你给我跪下给它道歉！

△马一花一记推搡。赵思楠纹丝不动。

1-5 日 外 操场中央
人物：全员、沈星晴

△马一花抡起篮球直接砸向赵思楠。
△赵思楠单手一挡，顺势抓住球。她虽然没学过球，但反应极快。

赵思楠：有力气，留着干活。

△赵思楠运球，虽然姿势极不规范，但速度惊人，直接冲到篮下。
△马一花从侧面拦截，两人撞在一起。赵思楠像块铁板，马一花直接被弹开。

△赵思楠跳起，将球重重砸向篮筐。
△由于用力过猛，篮球砸在铁圈上弹得老高。

沈星晴：（突然出现，高举右手接住落下的球）姿势不及格，但爆发力不错。

△众人愣住。沈星晴穿着简单的白T恤，骑着一辆共享单车，包里露出一截哨子。

沈星晴：我是新来的体育老师。

马一花：（抹了一把眼泪，不服气）老师？她弄坏了我的手办！

沈星晴：我看出来了，你们这儿解决问题的方式只有打架？

△沈星晴看向马一花，又看向赵思楠。

沈星晴：这样，既然都觉得自己厉害。三对三。

沈星晴：（指向赵思楠）你，去拉两个人。

沈星晴：（看向马一花）你们三个，别顶着"城里回来的"名号丢人。

沈星晴：谁输了，谁负责洗全校一个月的体育器材，并且，输的那方要公开道歉。

马一花：（咬牙）打就打！怕你这个乡巴佬？

赵思楠：（冷漠）随你。

△沈星晴把球扔给马一花，嘴角勾起一抹玩味的笑。

沈星晴：明天下午，这个框。

【字幕：青石镇中学 · 篮球赛首战 倒计时24小时】`,
	},
	{
		id: "basketball-girls-en",
		label: "Basketball Girls (English)",
		language: "English",
		description: "Campus basketball drama — 8 characters, 5 scenes, 49 shots",
		structure: {
			scriptData: EN_SCRIPT_DATA,
			characters: EN_CHARACTERS,
			scenes: EN_SCENES,
			episodes: EN_EPISODES,
			shots: EN_SHOTS,
		},
		content: `"Basketball Girls"

Synopsis: Three teenage girls, banished from big-city life back to a remote Hunan village after family upheavals, carry their urban pride and quiet desperation into a crumbling rural middle school. There they collide with a fierce young teacher chasing her own graduate-school ticket out. When city-league basketball skills meet raw village strength — and a prized collectible figurine shatters in the crossfire — these outcasts decide that on a dust-choked concrete court, one basketball can win back the dignity the world took from them.

Characters:
Ma Yihua (17): Hotheaded class athletic rep and figurine fanatic. Tough, blunt, deeply insecure. She treats her NBA star figurine as a lifeline.
Chen Moli (17): The drama queen "fence-sitter." Sharp-minded, precociously perceptive, skilled at playing dumb. She only plays basketball to fit in.
Ye Xiaoling (17): Acid-tongued bookworm. Proud, competitive, openly hostile toward rural life. Behind her cold exterior lies a photographic memory.
Shen Xingqing (22): Passionate volunteer teacher. Elite-university graduate, former provincial basketball team starter, rebellious and unconventional.
Zhao Sinan (18): The held-back "wild child." Cold on the outside, fiercely loyal within. Extraordinary physical strength from years of farm work.
Liu Na (16): The school tattletale. Timid, scarred by a family that favors boys. Hides behind her claim of being the dean's niece.

Episode 1: Figurine Bloodshed

Scene 1-1: EXT. RURAL ROAD / BUS - DAY
Characters: Shen Xingqing, Villager

A battered bus lurches along a winding mountain road. Terraced rice paddies stretch to the horizon outside the windows.
Shen Xingqing dozes against her seat. A hard jolt sends her suitcase sliding open. An orange basketball rolls into the aisle.

VILLAGER: (in thick dialect) Hey miss — here to teach?

Xingqing opens her eyes, a flicker of cool detachment in her gaze. She picks up the ball. The letters "MVP" on its surface are worn nearly smooth.

XINGQING: Here for grad-school credits.

She stuffs the ball back into her bag and stares out the window.
[TITLE CARD: Hunan — Qingshi Town]

Scene 1-2: EXT. SCHOOL BASKETBALL COURT - DAY
Characters: Ma Yihua, Chen Moli, Ye Xiaoling

A concrete court baking in the sun. The backboard is plywood, its edges split and peeling.
Ma Yihua carefully places a pristine NBA star figurine on the base of the basketball hoop, setting it on a clean tissue.

YIHUA: Bless me, babe. Fifty-percent shooting today — minimum.

MOLI: (holding a compact mirror, reapplying sunscreen) Yihua, this sun could peel paint off a wall. Your figurine's going to melt.

XIAOLING: (leaning against the hoop post, flipping through a vocabulary book) Given the UV index, the model's paint coating will undergo irreversible fading within two hours. Yihua, this is childish.

YIHUA: (dribbling, crisp crossover) Shut up! This is called a spiritual anchor! Watch and learn — I'll show you country bumpkins what a city-league fadeaway looks like!

Yihua jumps. She shoots. The ball clangs off the iron rim and bounces toward the grass at the edge of the court.

Scene 1-3: EXT. COURTSIDE TREE SHADE - DAY
Characters: Zhao Sinan, Liu Na, Troublemaking Boys

Zhao Sinan lies in the grass under a tree, arms behind her head, a straw hat over her face.
Nearby, a group of boys circles Liu Na, tossing her backpack between them.

LIU NA: Give it back! I swear I'll tell my uncle — I'll tell the dean!

BOY: Go ahead! Fake niece! Where's your held-back cousin? Tell her to come out!

BANG — a basketball slams into the ground at the boy's feet.
The straw hat flips off. Zhao Sinan sits up. Her eyes are wolf-cold.

SINAN: Ball. Pick it up.

The boys exchange a look, frozen by her presence. They drop the backpack and scatter.
Liu Na snatches up the basketball and tosses it behind her without looking.

LIU NA: Who just throws a ball around? No manners!

Scene 1-4: EXT. UNDER THE BASKETBALL HOOP - DAY
Characters: All from previous scenes

The basketball sails in a wobbly arc and smashes dead-center into the base of the hoop.
CRACK — the NBA star figurine takes the hit. Its body snaps apart. The head rolls across the concrete.

Ma Yihua freezes. The world stops for three full seconds.

YIHUA: (screaming) MY BABY—!

She lunges for the decapitated figurine, eyes instantly red.

YIHUA: (pointing at Liu Na) You're paying for this! Do you have any idea — this is a limited edition!

LIU NA: (scrambling behind Sinan) Who told you to put a toy there? This is a basketball court!

MOLI: (snapping her mirror shut, voice shrill) Oh, so you break someone's stuff and cop an attitude? Don't think your last name buys you connections.

XIAOLING: (closing her book, walking over, ice-cold) Intentional destruction of personal property exceeding five hundred yuan is a police matter. Yihua, skip the talk. Make her pay.

Zhao Sinan steps in front of Liu Na. She's half a head taller than Yihua, radiating the explosive power of someone who's hauled rice sacks since childhood.

SINAN: My sister threw the ball. You want money? Don't have any.

YIHUA: No money? Then get on your knees and apologize to it!

Yihua shoves her. Sinan doesn't budge an inch.

Scene 1-5: EXT. CENTER COURT - DAY
Characters: Everyone, Shen Xingqing

Yihua hurls the basketball straight at Sinan.
Sinan catches it one-handed without flinching. She's never trained, but her reflexes are terrifying.

SINAN: Save your energy. You'll need it for farm work.

Sinan starts dribbling — terrible form, but blinding speed. She charges to the basket.
Yihua cuts in from the side. They collide. Sinan is like a wall of iron. Yihua bounces off.

Sinan leaps and slams the ball at the rim. Too much force. The ball ricochets off the iron ring and rockets skyward.

XINGQING: (appearing out of nowhere, right hand raised, catching the falling ball) Terrible form. But the explosiveness — not bad.

Everyone freezes. Shen Xingqing stands in a plain white T-shirt, a shared bicycle behind her, a whistle poking out of her bag.

XINGQING: I'm the new PE teacher.

YIHUA: (wiping tears, defiant) Teacher? She wrecked my figurine!

XINGQING: I can see that. So the only way you people solve problems here is fighting?

Xingqing looks at Yihua, then at Sinan.

XINGQING: Alright. Since you both think you're tough. Three on three.

XINGQING: (pointing at Sinan) You — go find two more.

XINGQING: (looking at Yihua) You three — don't embarrass the "city girls" reputation.

XINGQING: Losers wash all the school's sports equipment for a month. And the losing side apologizes. Publicly.

YIHUA: (through gritted teeth) Fine! You think I'm scared of you hicks?

SINAN: (flat) Whatever.

Xingqing tosses the ball to Yihua. A sly smile curls at the corner of her mouth.

XINGQING: Tomorrow afternoon. This hoop.

[TITLE CARD: Qingshi Town Middle School — First Game: 24 Hours]`,
	},
];
