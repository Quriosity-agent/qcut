/**
 * Visual Style Presets
 * Ported from moyin-creator
 *
 * Unified visual style definitions shared across all modules
 * (script, characters, scenes, AI director).
 */

export type StyleCategory = "3d" | "2d" | "real" | "stop_motion";

/**
 * Media type — determines how prompt-builder translates cinematography params
 * - cinematic: Full physical camera vocabulary (live-action / realistic 3D)
 * - animation: Animation camera adaptation (2D animation / stylized 3D)
 * - stop-motion: Miniature practical constraints (stop-motion)
 * - graphic: Color/mood/rhythm only (pixel art / watercolor / line art)
 */
export type MediaType = "cinematic" | "animation" | "stop-motion" | "graphic";

export interface StylePreset {
	id: string;
	name: string;
	category: StyleCategory;
	mediaType: MediaType;
	prompt: string;
	negativePrompt: string;
	description: string;
}

// ============================================================
// 3D Styles
// ============================================================

const STYLES_3D: StylePreset[] = [
	{
		id: "3d_xuanhuan",
		name: "3D Xuanhuan",
		category: "3d",
		mediaType: "cinematic",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (stunning stylized 3D Chinese animation character render:1.3), (Unreal Engine 5 style:1.2), (cinematic lighting, soft volumetric fog:1.1), (smooth porcelain skin texture:1.1), (intricate traditional Chinese fabric details, fine embroidery, flowing robes:1.1), ethereal atmosphere, glowing spiritual energy, beautiful facial features, (delicate body proportions), sharp focus, detailed background",
		negativePrompt:
			"(worst quality, low quality, bad quality:1.4), (blurry, fuzzy, distorted, out of focus:1.3), (2D, flat, drawing, painting, sketch, anime, cartoon:1.2), (realistic, photo, real life, photography:1.1), (western style, modern clothing), (extra limbs, missing limbs, mutated hands, distorted body), ugly, watermark, signature, text, easynegative, bad-hands-5",
		description: "Chinese fantasy xianxia, UE5 render, stunning VFX",
	},
	{
		id: "3d_american",
		name: "3D American",
		category: "3d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (Disney Pixar style 3D animation:1.3), (expressive character design, large eyes:1.2), (subsurface scattering skin:1.1), (vibrant colors, warm lighting:1.1), cute, 3d render, cgsociety, detailed background, soft edges",
		negativePrompt:
			"(worst quality, low quality, bad quality:1.4), (blurry, fuzzy:1.3), (2D, flat, sketch, anime:1.2), (gloomy, dark, gritty), (realistic, photo), ugly, distorted",
		description: "Disney/Pixar style, American 3D animation, vibrant colors",
	},
	{
		id: "3d_q_version",
		name: "3D Chibi",
		category: "3d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (Pop Mart blind box style:1.3), (chibi 3d rendering:1.2), (Oc render:1.2), (soft studio lighting, rim light:1.1), (plastic material, smooth texture:1.1), cute, super deformed, clean background, c4d render",
		negativePrompt:
			"(worst quality, low quality:1.4), (rough surface), (realistic skin texture), (2D, flat), dark, scary, ugly",
		description: "Blind box / designer toy style, chibi 3D, C4D render",
	},
	{
		id: "3d_realistic",
		name: "3D Realistic",
		category: "3d",
		mediaType: "cinematic",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (photorealistic 3D render:1.3), (hyperrealistic details:1.2), (Unreal Engine 5:1.2), (cinematic lighting, ray tracing:1.1), (highly detailed texture, pores, imperfections:1.1), sharp focus, depth of field",
		negativePrompt:
			"(worst quality, low quality:1.4), (cartoon, anime, painting, sketch:1.3), (stylized, 2D, flat), blurry, low res, plastic skin",
		description: "Hyperrealistic 3D, cinematic lighting, 8K textures",
	},
	{
		id: "3d_block",
		name: "3D Low Poly",
		category: "3d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k:1.2), (low poly art style:1.3), (minimalist 3D:1.2), (sharp edges, geometric shapes:1.2), (flat shading, simple colors:1.1), polygon art, clean composition",
		negativePrompt:
			"(worst quality, low quality:1.4), (detailed texture, realistic, high poly), (round, smooth, soft), (2D, sketch), noise",
		description: "Low polygon, geometric blocks, minimalist style",
	},
	{
		id: "3d_voxel",
		name: "3D Voxel World",
		category: "3d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k:1.2), (Minecraft style voxel art:1.3), (cubic blocks:1.2), (8-bit 3d:1.1), lego style, sharp focus, vibrant colors, isometric view",
		negativePrompt:
			"(worst quality, low quality:1.4), (round, curved, organic shapes), (realistic, high resolution texture), (2D, flat), blur",
		description: "Minecraft style, voxel art, blocky aesthetic",
	},
	{
		id: "3d_mobile",
		name: "3D Mobile Game",
		category: "3d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (unity engine mobile game style:1.3), (stylized 3D character:1.2), (cel shaded 3d:1.1), (clean textures, vibrant aesthetic:1.1), game asset, polished",
		negativePrompt:
			"(worst quality, low quality:1.4), (sketch, rough), (photorealistic, heavy noise), (2D, flat), ugly, pixelated",
		description: "3D mobile game style, Unity render, stylized 3D",
	},
	{
		id: "3d_render_2d",
		name: "3D to 2D Render",
		category: "3d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (Genshin Impact style:1.3), (cel shaded 3D:1.2), (anime style 3d rendering:1.2), (clean lines, vibrant anime colors:1.1), 2.5d, toon shading",
		negativePrompt:
			"(worst quality, low quality:1.4), (realistic, photorealistic:1.3), (sketch, rough lines), (heavy shadows), ugly, distorted",
		description: "Cel-shaded 3D, Genshin Impact style, toon rendering",
	},
	{
		id: "jp_3d_render_2d",
		name: "Japanese 3D to 2D",
		category: "3d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (Guilty Gear Strive style:1.3), (Japanese anime 3D render:1.2), (dynamic camera angles:1.1), (sharp cel shading:1.1), vibrant colors, detailed character design",
		negativePrompt:
			"(worst quality, low quality:1.4), (realistic, photorealistic:1.3), (western cartoon), (flat colors, dull), ugly",
		description:
			"Japanese cel-shaded 3D, Guilty Gear Strive style, vivid anime colors",
	},
];

// ============================================================
// 2D Animation Styles
// ============================================================

const STYLES_2D: StylePreset[] = [
	{
		id: "2d_animation",
		name: "2D Animation",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (standard Japanese anime style:1.3), (clean lineart, flat color:1.2), (anime character design:1.1), vibrant, detailed eyes",
		negativePrompt:
			"(worst quality, low quality:1.4), (3D, realistic, photorealistic, cgi:1.3), (sketch, messy), ugly, bad anatomy",
		description: "Standard Japanese 2D anime style",
	},
	{
		id: "2d_movie",
		name: "2D Movie",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (Makoto Shinkai style:1.3), (breathtaking cinematic lighting:1.2), (highly detailed background, clouds, starry sky:1.1), (sentimental atmosphere:1.1), anime movie still, high budget animation",
		negativePrompt:
			"(worst quality, low quality:1.4), (simple, flat, cartoon), (3D, realistic), (dull colors), low resolution",
		description: "Anime movie quality, Makoto Shinkai style, detailed backgrounds",
	},
	{
		id: "2d_fantasy",
		name: "2D Fantasy",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (fantasy anime style:1.3), (magical atmosphere, glowing particles:1.2), (intricate armor and robes:1.1), (vibrant mystical colors:1.1), world of magic, dreamy",
		negativePrompt:
			"(worst quality, low quality:1.4), (modern setting, sci-fi), (3D, realistic), dark and gritty, ugly",
		description: "Fantasy anime, magical world, dreamy colors",
	},
	{
		id: "2d_retro",
		name: "2D Retro",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k:1.2), (90s retro anime style:1.3), (cel animation aesthetic:1.2), (vintage VHS effect, lo-fi:1.1), (Sailor Moon style:1.1), matte painting background, nostalgic",
		negativePrompt:
			"(worst quality, low quality:1.4), (digital painting, modern anime style, 3D), (high definition, sharp), (glossy)",
		description: "90s retro anime, cel animation, lo-fi aesthetic",
	},
	{
		id: "2d_american",
		name: "2D American",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k:1.2), (Cartoon Network style:1.3), (bold thick outlines:1.2), (exaggerated expressions:1.1), (western cartoon aesthetic:1.1), flat colors, energetic",
		negativePrompt:
			"(worst quality, low quality:1.4), (anime, manga style), (3D, realistic, shaded), (delicate lines), ugly",
		description: "American cartoon, Cartoon Network style, bold outlines",
	},
	{
		id: "2d_ghibli",
		name: "2D Ghibli",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (Studio Ghibli style:1.3), (Hayao Miyazaki:1.2), (hand painted watercolor background:1.2), (peaceful nature atmosphere:1.1), soft colors, charming characters",
		negativePrompt:
			"(worst quality, low quality:1.4), (sharp digital lines), (3D, realistic, cgi), (neon colors), dark, scary",
		description: "Studio Ghibli / Miyazaki style, watercolor backgrounds",
	},
	{
		id: "2d_retro_girl",
		name: "2D Retro Shoujo",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k:1.2), (80s shoujo manga style:1.3), (sparkly big eyes:1.2), (pastel colors, flowers and bubbles:1.1), (retro fashion:1.1), dreamy, romantic",
		negativePrompt:
			"(worst quality, low quality:1.4), (modern digital art), (3D, realistic), (dark, horror), (thick lines), ugly",
		description: "80s shoujo manga style, sparkly eyes, pastel palette",
	},
	{
		id: "2d_korean",
		name: "2D Korean Webtoon",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (premium Webtoon style:1.3), (sharp handsome facial features:1.2), (detailed digital coloring, glowing eyes:1.1), (modern fashion:1.1), manhwa aesthetic",
		negativePrompt:
			"(worst quality, low quality:1.4), (Japanese anime style), (retro), (3D, realistic), (sketch), ugly",
		description: "Korean webtoon / manhwa style, detailed digital coloring",
	},
	{
		id: "2d_shonen",
		name: "2D Shonen",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (Shonen anime style:1.3), (dynamic high-impact pose:1.2), (intense action lines, speed lines:1.1), (high contrast shading:1.1), powerful, energetic",
		negativePrompt:
			"(worst quality, low quality:1.4), (calm, static), (shoujo style, soft), (3D, realistic), (pastel colors), boring",
		description: "Shonen manga, dynamic poses, speed lines, high contrast",
	},
	{
		id: "2d_akira",
		name: "2D Toriyama",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k:1.2), (Akira Toriyama art style:1.3), (Dragon Ball Z style:1.2), (muscular definition:1.1), (sharp angular eyes:1.1), retro shonen, iconic",
		negativePrompt:
			"(worst quality, low quality:1.4), (modern soft anime), (shoujo), (3D, realistic), (round features), ugly",
		description: "Akira Toriyama / Dragon Ball style",
	},
	{
		id: "2d_doraemon",
		name: "2D Doraemon",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k:1.2), (Doraemon style:1.3), (Fujiko F Fujio:1.2), (simple round character design:1.2), (childlike and cute:1.1), bright colors, clean lines",
		negativePrompt:
			"(worst quality, low quality:1.4), (complex details, realistic), (sharp angles), (dark, gloomy), (3D), scary",
		description: "Doraemon / Fujiko F. Fujio style",
	},
	{
		id: "2d_fujimoto",
		name: "2D Fujimoto",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k:1.2), (Tatsuki Fujimoto style:1.3), (sketchy loose lines:1.2), (cinematic movie composition:1.1), (raw emotion:1.1), chainsaw man manga style, unique",
		negativePrompt:
			"(worst quality, low quality:1.4), (polished digital art), (standard anime), (3D, realistic), (moe, kawaii), boring",
		description: "Tatsuki Fujimoto / Chainsaw Man style, raw sketchy lines",
	},
	{
		id: "2d_mob",
		name: "2D Mob Psycho",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k:1.2), (Mob Psycho 100 style:1.3), (ONE style:1.2), (psychedelic colors:1.1), (warped perspective:1.1), urban fantasy, supernatural",
		negativePrompt:
			"(worst quality, low quality:1.4), (realistic proportions), (standard anime beauty), (3D), (calm colors), boring",
		description: "Mob Psycho 100 style, psychedelic colors, warped perspective",
	},
	{
		id: "2d_jojo",
		name: "2D JoJo",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k:1.2), (Jojo's Bizarre Adventure style:1.3), (Araki Hirohiko artstyle:1.2), (heavy shading, harsh lines:1.1), (fabulous pose, muscular:1.1), menacing text, detailed",
		negativePrompt:
			"(worst quality, low quality:1.4), (moe, cute, soft), (minimalist), (3D, realistic), (thin lines), weak",
		description: "JoJo / Araki Hirohiko style, heavy shading, fabulous poses",
	},
	{
		id: "2d_detective",
		name: "2D Detective",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k:1.2), (Detective Conan style:1.3), (Gosho Aoyama:1.2), (distinctive sharp nose and ears:1.1), (mystery atmosphere:1.1), 90s anime aesthetic",
		negativePrompt:
			"(worst quality, low quality:1.4), (modern detailed eye), (3D, realistic), (fantasy), ugly",
		description: "Detective Conan / Gosho Aoyama style",
	},
	{
		id: "2d_slamdunk",
		name: "2D Slam Dunk",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (Slam Dunk style:1.3), (Takehiko Inoue:1.2), (realistic body proportions:1.1), (detailed muscle and sweat:1.1), intense sports atmosphere, 90s anime",
		negativePrompt:
			"(worst quality, low quality:1.4), (chibi, moe), (fantasy), (3D), (distorted anatomy), weak",
		description: "Slam Dunk / Takehiko Inoue style, realistic proportions",
	},
	{
		id: "2d_astroboy",
		name: "2D Tezuka",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k:1.2), (Osamu Tezuka style:1.3), (classic Astro Boy aesthetic:1.2), (large expressive eyes, rounded features:1.1), black and white or vintage color, iconic",
		negativePrompt:
			"(worst quality, low quality:1.4), (modern anime), (sharp angles), (3D, realistic), (complex shading), ugly",
		description: "Osamu Tezuka / Astro Boy style, classic rounded lines",
	},
	{
		id: "2d_deathnote",
		name: "2D Death Note",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (Death Note style:1.3), (Takeshi Obata:1.2), (gothic dark atmosphere:1.1), (intricate cross-hatching, sharp features:1.1), serious, mystery",
		negativePrompt:
			"(worst quality, low quality:1.4), (cute, happy, bright colors), (chibi), (thick lines), (3D), ugly",
		description: "Death Note / Obata style, gothic dark atmosphere",
	},
	{
		id: "2d_thick_line",
		name: "2D Graffiti",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k:1.2), (Graffiti art style:1.3), (bold thick black outlines:1.2), (urban street art:1.1), (vibrant contrast colors:1.1), stylized, cool",
		negativePrompt:
			"(worst quality, low quality:1.4), (thin delicate lines), (realistic, painting), (faded colors), (3D), boring",
		description: "Graffiti style, bold outlines, street art aesthetic",
	},
	{
		id: "2d_rubberhose",
		name: "2D Rubber Hose",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k:1.2), (1930s rubber hose animation:1.3), (Cuphead style:1.2), (vintage Disney style:1.1), (black and white, film grain:1.1), swinging limbs, pie eyes",
		negativePrompt:
			"(worst quality, low quality:1.4), (modern cartoon), (color), (3D, realistic), (anime), (stiff animation)",
		description: "1930s rubber hose animation, Cuphead style",
	},
	{
		id: "2d_q_version",
		name: "2D Chibi",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k:1.2), (kawaii chibi style:1.3), (super deformed characters:1.2), (soft pastel colors:1.1), (simple shading:1.1), cute, adorable",
		negativePrompt:
			"(worst quality, low quality:1.4), (realistic proportions), (mature, dark), (3D, realistic), (horror), ugly",
		description: "Chibi / kawaii style, pastel colors",
	},
	{
		id: "2d_pixel",
		name: "2D Pixel Art",
		category: "2d",
		mediaType: "graphic",
		prompt: "(best quality, masterpiece, 8k:1.2), (pixel art style:1.3), (16-bit game sprite:1.2), (retro gaming aesthetic:1.1), (dithering:1.1), clean pixels, colorful",
		negativePrompt:
			"(worst quality, low quality:1.4), (vector art), (smooth lines), (3D, realistic), (blur), (anti-aliasing)",
		description: "Pixel art, 8-bit / 16-bit retro gaming style",
	},
	{
		id: "2d_gongbi",
		name: "2D Gongbi",
		category: "2d",
		mediaType: "graphic",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (Chinese Gongbi painting style:1.3), (meticulous brushwork:1.2), (elegant traditional art:1.1), (ink wash painting background:1.1), delicate, cultural",
		negativePrompt:
			"(worst quality, low quality:1.4), (western art style), (oil painting), (sketchy), (3D, realistic), (vibrant neon colors)",
		description: "Chinese Gongbi painting, meticulous brushwork",
	},
	{
		id: "2d_stick",
		name: "2D Stick Figure",
		category: "2d",
		mediaType: "graphic",
		prompt: "(best quality, masterpiece, 8k:1.2), (minimalist stick figure style:1.3), (hand drawn doodle:1.2), (sketchbook aesthetic:1.1), simple lines, white background, cute",
		negativePrompt:
			"(worst quality, low quality:1.4), (complex, detailed, realistic), (color filled), (3D), (shading)",
		description: "Stick figure, doodle, minimalist hand-drawn",
	},
	{
		id: "2d_watercolor",
		name: "2D Watercolor",
		category: "2d",
		mediaType: "graphic",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (watercolor painting style:1.3), (wet on wet technique:1.2), (soft edges, artistic strokes:1.1), (paper texture:1.1), dreamy, illustration",
		negativePrompt:
			"(worst quality, low quality:1.4), (digital flat color), (sharp hard lines), (3D, realistic), (vector art), ugly",
		description: "Watercolor painting, wet-on-wet technique, artistic",
	},
	{
		id: "2d_simple_line",
		name: "2D Line Art",
		category: "2d",
		mediaType: "graphic",
		prompt: "(best quality, masterpiece, 8k:1.2), (minimalist line art:1.3), (clean continuous line:1.2), (vector style:1.1), (black lines on white:1.1), elegant, simple",
		negativePrompt:
			"(worst quality, low quality:1.4), (sketchy, messy), (colored), (shaded, 3D, realistic), (complex background)",
		description: "Clean line art, vector style, white background",
	},
	{
		id: "2d_comic",
		name: "2D American Comic",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (American comic book style:1.3), (Marvel/DC comic style:1.2), (halftone dots, hatching:1.1), (dynamic action, speech bubbles:1.1), vibrant ink",
		negativePrompt:
			"(worst quality, low quality:1.4), (manga style), (chibi), (3D, realistic), (watercolor), (blurry)",
		description: "American comic book, halftone, Marvel/DC style",
	},
	{
		id: "2d_shoujo",
		name: "2D Shoujo Manga",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (classic Shoujo manga style:1.3), (delicate thin lines:1.2), (flowery background, screentones:1.1), (emotional expression:1.1), beautiful, romantic",
		negativePrompt:
			"(worst quality, low quality:1.4), (shonen style), (thick bold lines), (3D, realistic), (dark, horror), ugly",
		description: "Shoujo manga, delicate lines, flowery backgrounds",
	},
	{
		id: "2d_horror",
		name: "2D Horror",
		category: "2d",
		mediaType: "animation",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (Junji Ito horror manga:1.3), (grotesque art style:1.2), (heavy black ink, spirals:1.1), (creepy atmosphere:1.1), body horror, nightmare",
		negativePrompt:
			"(worst quality, low quality:1.4), (cute, happy), (bright colors), (3D, realistic), (soft), safe",
		description: "Junji Ito horror manga style, spirals, grotesque",
	},
];

// ============================================================
// Realistic Styles
// ============================================================

const STYLES_REAL: StylePreset[] = [
	{
		id: "real_movie",
		name: "Cinematic Film",
		category: "real",
		mediaType: "cinematic",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (cinematic movie still:1.3), (35mm film grain:1.2), (dramatic movie lighting:1.1), (color graded:1.1), photorealistic, depth of field",
		negativePrompt:
			"(worst quality, low quality:1.4), (3D render, cgi, game), (anime, illustration, painting), (cartoon), artificial, fake",
		description: "Movie still, film grain, cinematic color grading",
	},
	{
		id: "real_costume",
		name: "Period Drama",
		category: "real",
		mediaType: "cinematic",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (Chinese period drama style:1.3), (Hanfu traditional costume:1.2), (exquisite embroidery:1.1), (elegant ancient setting:1.1), photorealistic, cinematic lighting",
		negativePrompt:
			"(worst quality, low quality:1.4), (modern clothing, glasses, watch), (3D render, anime), (western background), ugly",
		description: "Period drama style, traditional costumes, elegant settings",
	},
	{
		id: "real_hk_retro",
		name: "HK Retro Film",
		category: "real",
		mediaType: "cinematic",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (90s Hong Kong movie style:1.3), (Wong Kar-wai aesthetic:1.2), (neon lights, high contrast:1.1), (motion blur, film grain:1.1), dreamy, moody",
		negativePrompt:
			"(worst quality, low quality:1.4), (modern digital look), (clean, sharp, sterile), (3D, anime), (bright daylight), ugly",
		description: "90s Hong Kong cinema, Wong Kar-wai style, neon moody",
	},
	{
		id: "real_wuxia",
		name: "Retro Wuxia Film",
		category: "real",
		mediaType: "cinematic",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (Shaw Brothers Wuxia style:1.3), (vintage kung fu movie:1.2), (martial arts pose:1.1), (retro film aesthetic:1.1), photorealistic, cinematic",
		negativePrompt:
			"(worst quality, low quality:1.4), (fantasy effects, cgi), (modern clothing), (anime, 3D), (high fancy tech), ugly",
		description: "Retro wuxia film, Shaw Brothers style",
	},
	{
		id: "real_bloom",
		name: "Dreamy Bloom",
		category: "real",
		mediaType: "cinematic",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (dreamy soft focus photography:1.3), (strong bloom, lens flare:1.2), (backlit by sun:1.1), (ethereal lighting:1.1), photorealistic, angelic",
		negativePrompt:
			"(worst quality, low quality:1.4), (sharp, harsh contrast), (dark, gloomy), (anime, 3D), (flat lighting), ugly",
		description: "Dreamy bloom, backlit, ethereal lighting effect",
	},
];

// ============================================================
// Stop Motion Styles
// ============================================================

const STYLES_STOP_MOTION: StylePreset[] = [
	{
		id: "stop_motion",
		name: "Stop Motion",
		category: "stop_motion",
		mediaType: "stop-motion",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (stop motion animation style:1.3), (claymation texture:1.2), (handmade props:1.1), (frame by frame look:1.1), tactile, studio lighting",
		negativePrompt:
			"(worst quality, low quality:1.4), (fluid computer animation, cgi), (2D, anime), (smooth digital texture), ugly",
		description: "Stop motion animation, claymation texture",
	},
	{
		id: "figure_stop_motion",
		name: "Figure Animation",
		category: "stop_motion",
		mediaType: "stop-motion",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (PVC action figure photography:1.3), (toy photography:1.2), (plastic texture, sub-surface scattering:1.1), (macro photography, depth of field:1.1), realistic toy",
		negativePrompt:
			"(worst quality, low quality:1.4), (human skin texture), (2D, anime), (drawing, sketch), (life size), ugly",
		description: "Action figure photography, PVC plastic texture",
	},
	{
		id: "clay_stop_motion",
		name: "Clay Animation",
		category: "stop_motion",
		mediaType: "stop-motion",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (Aardman style claymation:1.3), (plasticine material:1.2), (visible fingerprints and imperfections:1.1), (soft clay texture:1.1), handmade, cute",
		negativePrompt:
			"(worst quality, low quality:1.4), (smooth plastic), (3D render, shiny), (2D, anime), (realistic human), ugly",
		description: "Aardman claymation, plasticine with fingerprints",
	},
	{
		id: "lego_stop_motion",
		name: "Lego Animation",
		category: "stop_motion",
		mediaType: "stop-motion",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (Lego stop motion:1.3), (plastic brick texture:1.2), (construction toy aesthetic:1.1), (macro lens:1.1), toy world, vibrant",
		negativePrompt:
			"(worst quality, low quality:1.4), (melted, curved shapes), (clay, soft), (2D, anime), (realistic), ugly",
		description: "Lego brick style, plastic toy world",
	},
	{
		id: "felt_stop_motion",
		name: "Felt Animation",
		category: "stop_motion",
		mediaType: "stop-motion",
		prompt: "(best quality, masterpiece, 8k, high detailed:1.2), (needle felting animation:1.3), (wool texture, fuzzy:1.2), (soft fabric material:1.1), (handmade craft:1.1), warm atmosphere, cute",
		negativePrompt:
			"(worst quality, low quality:1.4), (hard plastic), (smooth, shiny), (2D, anime), (realistic), ugly",
		description: "Needle felting, wool texture, cozy handmade feel",
	},
];

// ============================================================
// Exports
// ============================================================

/** All style presets */
export const VISUAL_STYLE_PRESETS: readonly StylePreset[] = [
	...STYLES_3D,
	...STYLES_2D,
	...STYLES_REAL,
	...STYLES_STOP_MOTION,
] as const;

/** Category info with style lists */
export const STYLE_CATEGORIES: {
	id: StyleCategory;
	name: string;
	styles: readonly StylePreset[];
}[] = [
	{ id: "3d", name: "3D Styles", styles: STYLES_3D },
	{ id: "2d", name: "2D Animation", styles: STYLES_2D },
	{ id: "real", name: "Realistic", styles: STYLES_REAL },
	{ id: "stop_motion", name: "Stop Motion", styles: STYLES_STOP_MOTION },
];

/** Get style by ID */
export function getStyleById(styleId: string): StylePreset | undefined {
	return VISUAL_STYLE_PRESETS.find((s) => s.id === styleId);
}

/** Get style prompt text */
export function getStylePrompt(styleId: string): string {
	const style = getStyleById(styleId);
	return style?.prompt || VISUAL_STYLE_PRESETS[0].prompt;
}

/** Get style negative prompt text */
export function getStyleNegativePrompt(styleId: string): string {
	const style = getStyleById(styleId);
	return style?.negativePrompt || VISUAL_STYLE_PRESETS[0].negativePrompt;
}

/** Get style name */
export function getStyleName(styleId: string): string {
	const style = getStyleById(styleId);
	return style?.name || styleId;
}

/** Get styles by category */
export function getStylesByCategory(categoryId: string): StylePreset[] {
	const categoryMap: Record<string, StyleCategory[]> = {
		animation: ["3d", "2d", "stop_motion"],
		realistic: ["real"],
		"3d": ["3d"],
		"2d": ["2d"],
		real: ["real"],
		stop_motion: ["stop_motion"],
	};

	const targetCategories =
		categoryMap[categoryId] || ([categoryId] as StyleCategory[]);
	return VISUAL_STYLE_PRESETS.filter((s) =>
		targetCategories.includes(s.category),
	);
}

/** Get style description */
export function getStyleDescription(styleId: string): string {
	const style = getStyleById(styleId);
	return style?.description || style?.name || styleId;
}

/** Get media type for a style */
export function getMediaType(styleId: string): MediaType {
	const style = getStyleById(styleId);
	return style?.mediaType ?? "cinematic";
}

/** Default style ID */
export const DEFAULT_STYLE_ID = "2d_ghibli";

/** Style ID type (union of all valid IDs) */
export type VisualStyleId = (typeof VISUAL_STYLE_PRESETS)[number]["id"];
