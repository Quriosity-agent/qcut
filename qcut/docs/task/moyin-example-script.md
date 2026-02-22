# Moyin Script Format — Default Example

This document provides a ready-to-paste example script for the Moyin (魔因漫创) script editor.
Copy the content inside the code block and paste it into the **Script Editor > Import** panel.

Based on the original demo project 《灌篮少女》(Slam Dunk Girl).

## Format Reference

The episode parser (`episode-parser.ts`) expects:

| Element | Format | Example |
|---------|--------|---------|
| Title | `《Title》` | `《灌篮少女》` |
| Outline | `大纲：` block before character bios | Free-form synopsis |
| Character bios | `人物小传：` block before episodes | `Name（Age）：Description` |
| Episode | `第X集 Title` | `第一集 手办血案` |
| Scene header | `**N-N Time Int/Ext Location**` | `**1-1 日 内 中学操场**` |
| Character list | `人物：CharA、CharB` | Inside scene block |
| Action line | `△Description` | `△阳光照在操场上` |
| Dialogue | `Name：（Action）Line` | `马一花：（笑）我来了！` |
| Subtitle/note | `【字幕：Text】` | `【字幕：三年前】` |

## Default Example Script — Slam Dunk Girl (灌篮少女)

```
《灌篮少女》

大纲：三个因家庭变故从大城市"流放"回湖南山村的少女，带着格格不入的傲气与失落，意外撞上了一心想保研的"剃头"女老师。当都市篮球技术遇见乡村野路子怪力，在破碎手办引发的冲突中，这群被生活放逐的少女决定在尘土飞扬的操场上，用一颗篮球赢回属于自己的尊严。

人物小传：
马一花（17）：暴躁体委/手办狂魔。强悍直率，热爱篮球和收藏手办。从城市转学到乡村中学，不服输的性格让她在新环境中处处碰壁，但也因此结交了志同道合的伙伴。
赵思楠（25）：乡村中学体育老师，一心想保研离开山村。表面冷漠严厉，内心对学生有着深深的责任感。曾是省队篮球运动员，因伤退役后被分配到这所偏远中学。
陈茉莉（17）：马一花的同班同学，性格温柔但内心坚韧。家境贫寒，父母在外打工，由奶奶抚养长大。虽然身材瘦小，但有着惊人的速度和灵活性。
叶小玲（17）：班上的文静女生，戴眼镜，喜欢读书。被同学们认为是"书呆子"，但其实有着过目不忘的记忆力，后来成为球队的战术分析师。
刘娜（30）：中学教导主任，严肃刻板，反对学生把时间花在"不务正业"的篮球上。是赵思楠保研路上的最大阻碍。

第一集 手办血案

**1-1 日 外 乡村公路/大巴车**
人物：马一花

△一辆老旧的乡村大巴沿着蜿蜒山路行驶，车窗外是连绵的稻田和远处的青山。

【字幕：湖南，某山村中学】

△马一花坐在大巴最后一排，怀里紧紧抱着一个装满手办的纸箱。耳机里放着嘈杂的音乐，她面无表情地看着窗外陌生的风景。

△大巴颠簸了一下，箱子差点滑落。马一花赶紧抓住，低头看了眼箱子里的手办，眼神有一瞬间的柔软。

马一花：（自言自语）就这破路……要是摔坏了我跟他们拼命。

**1-2 日 外 中学操场**
人物：马一花、赵思楠、陈茉莉、叶小玲、刘娜、男同学

△中午的操场，水泥地上篮板是木头做的，边缘已经开裂。几个男生在打篮球，动作粗野。

△马一花抱着纸箱从教学楼走出来，经过操场时停下脚步，看着男生们打球。

△一个男生投篮失误，球砸在篮框上弹飞，直直朝马一花飞来。

马一花：（下意识单手接住球，纸箱夹在另一臂下）喂！长没长眼睛？

△男生们愣了一下，随即嬉笑起来。

男同学：哟，新来的还会打球？女生就该在旁边看着。

△马一花眼睛一眯，把纸箱放在地上，拍了拍球，一个变向过掉两个男生，轻松上篮得分。

△操场边，赵思楠抱着篮球教案走过，看到这一幕，微微顿了一下脚步。

陈茉莉：（小声跟叶小玲说）新来的转学生好厉害……
叶小玲：（推了推眼镜）嗯，基本功很扎实。

△马一花捡回球，准备走，却发现纸箱被一个男生不小心踩了一脚。她蹲下打开箱子，一个限量版手办的手臂断了。

马一花：（脸色骤变，声音发抖）你……踩了我的手办……

△男同学们看情况不对，开始后退。

马一花：（站起来，眼眶发红，攥紧拳头）这是绝版的！你赔得起吗？！

△冲突一触即发。

**1-3 日 外 操场边缘树荫**
人物：赵思楠、马一花、刘娜、男同学

△操场边的大树下，赵思楠躺在草地上闭目养神，草帽盖在脸上。

△远处传来争吵声。赵思楠掀开草帽，看到马一花揪住一个男生的衣领。

刘娜：（急匆匆赶来）又怎么了！马一花，你第一天就打架？
男同学：老师，她先动手的！
马一花：（不松手）他踩坏了我的东西！

△赵思楠慢悠悠走过来，看了看地上的碎手办，又看了看马一花通红的眼睛。

△篮球"砰"地一声砸在男生脚下。男生们吓了一跳。

赵思楠：（冷漠地）散了。

△男生们对视一眼，被赵思楠的气场震住，丢下篮球跑了。

刘娜：（严厉地）赵老师，你不能这样纵容——
赵思楠：（对马一花说）球，捡起来。
马一花：（愣住）什么？
赵思楠：（转身走了）你的手办我赔不了，但那个上篮——不错。明天下午操场见。

△马一花怔怔地站在原地，手里攥着断掉的手办，看着赵思楠远去的背影。

**1-4 日 外 操场篮球架下**
人物：赵思楠、马一花、陈茉莉、叶小玲

△放学后的操场，夕阳将一切染成金色。赵思楠一个人在篮球架下练球，动作干脆利落。

△马一花远远站在操场边，犹豫了一会儿，最终走了过去。

马一花：（别扭地）你说……明天来，但我今天就来了。
赵思楠：（投篮，球空心入网）你来早了。
马一花：我不想欠你人情。你帮我解了围，我——

△赵思楠把球传给马一花。

赵思楠：少废话。一对一，你赢了，我帮你修手办。你输了，加入篮球队。
马一花：（接住球，傻眼了）你这里哪来的篮球队？
赵思楠：（微微一笑）还没有。所以需要你。

△两人开始一对一。马一花技术花哨但体力不足，赵思楠基本功扎实且经验丰富。

△操场边，陈茉莉和叶小玲偷偷在看。

陈茉莉：（眼睛发亮）好想加入啊……
叶小玲：（记笔记）马一花的变向速度0.8秒，突破成功率73%……

△最终，马一花气喘吁吁地输了。

马一花：（不服气）再来一局！
赵思楠：（丢过来一瓶水）明天再来。带上那两个偷看的。

△陈茉莉和叶小玲吓得缩回墙角。

**1-5 日 外 操场中央**
人物：马一花、陈茉莉、叶小玲、赵思楠

△第二天下午，操场中央。马一花、陈茉莉、叶小玲三人站成一排，面对赵思楠。

赵思楠：（扫视三人）就你们三个？
马一花：（双手抱胸）三个怎么了？三个也能打球。
陈茉莉：（紧张地举手）那个……我其实不太会打球……
叶小玲：（推眼镜）我负责数据分析可以吗？

△赵思楠沉默了一会儿，从包里掏出四件旧球衣。

赵思楠：这是我大学时省队的训练服。（把球衣分别扔给三人）从今天起，每天放学，操场集合。
马一花：（看着球衣上的号码，愣住）你是省队的？
赵思楠：（转身走向球场）曾经是。

△夕阳下，四个身影在操场上拉长。赵思楠开始教她们基础运球。

△远处教学楼的窗口，刘娜皱着眉看着操场上的一切。

【字幕：灌篮少女，正式开始】

第二集 魔鬼训练
```

## Parser Compatibility Notes

1. **Title extraction**: Uses `《》` or `「」` brackets
2. **Outline section**: Must appear before `人物小传` and before `第X集`
3. **Character bios**: Format is `Name（Age）：Description`; parser extracts personality and traits automatically
4. **Episode markers**: Supports Chinese numerals (`第一集`) and Arabic (`第1集`)
5. **Scene headers**: Standard format is `**N-N Time Int/Ext Location**`
   - Time values: `日`/`夜`/`晨`/`暮`/`黄昏`/`黎明`/`清晨`/`傍晚`
   - Interior/exterior: `内`/`外`/`内/外`
6. **Character line**: `人物：` followed by names separated by `、`
7. **Action lines**: Start with `△` (triangle marker)
8. **Dialogue**: `Name：（parenthetical）dialogue text`
9. **Subtitles**: Wrapped in `【】` brackets

## What Happens After Import

1. **Script Parser** extracts title, outline, character bios, and episode structure
2. **Episode Parser** splits into episodes > scenes > raw content
3. **AI Scene Calibration** enriches scenes with visual prompts, architecture, lighting
4. **AI Character Calibration** generates identity anchors and visual descriptions
5. **Shot Generation** creates per-scene shot breakdowns (CU/MS/WS) with camera, audio, and visual design
6. **Storyboard View** displays the tree: Episodes > Scenes > Shots (as shown in the UI)

## UI Mapping (from screenshot)

| UI Panel | Data Source |
|----------|------------|
| Left: Script Editor (剧本编辑) | Raw script text pasted here |
| Center: Episode Structure (剧集结构) | Parsed episodes > scenes > shots tree |
| Right: Shot Detail (分镜 N) | Individual shot with CU/MS/WS, visual, action, audio, characters |
| Shot types | CU = Close-Up, MS = Medium Shot, WS = Wide Shot |
| Status badges | Static / Dynamic, duration (e.g. 3s) |
| Bottom buttons | "Go to AI Generation" (去AI导演生成), "Copy 3-layer prompt data" (复制三层提词数据) |
