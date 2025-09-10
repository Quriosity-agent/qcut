
import type { Transformation } from './types';

export const TRANSFORMATIONS: Transformation[] = [
  // Viral & Fun Transformations
  { 
    title: "Custom Prompt", 
    prompt: "CUSTOM", 
    emoji: "✍️",
    description: "Describe any change you can imagine. Your creativity is the only limit!"
  },
  { 
    title: "3D Figurine", 
    prompt: "turn this photo into a character figure. Behind it, place a box with the character’s image printed on it, and a computer showing the Blender modeling process on its screen. In front of the box, add a round plastic base with the character figure standing on it. set the scene indoors if possible", 
    emoji: "🧍",
    description: "Turns your photo into a collectible 3D character figurine, complete with packaging."
  },
  { 
    title: "Funko Pop Figure", 
    prompt: "Transform the person into a Funko Pop figure, shown inside and next to its packaging.", 
    emoji: "📦",
    description: "Reimagines your subject as an adorable Funko Pop! vinyl figure in its box."
  },
  { 
    title: "LEGO Minifigure", 
    prompt: "Transform the person into a LEGO minifigure, inside its packaging box.", 
    emoji: "🧱",
    description: "Builds a LEGO minifigure version of your subject, ready for play."
  },
  { 
    title: "Crochet Doll", 
    prompt: "Transform the subject into a handmade crocheted yarn doll with a cute, chibi-style appearance.", 
    emoji: "🧶",
    description: "Transforms your image into a soft, handmade crochet doll."
  },
  { 
    title: "Anime to Cosplay", 
    prompt: "Generate a highly detailed, realistic photo of a person cosplaying the character in this illustration. Replicate the pose, expression, and framing.", 
    emoji: "🎭",
    description: "Brings an anime character to life as a realistic cosplay photo."
  },
  { 
    title: "Cute Plushie", 
    prompt: "Turn the person in this photo into a cute, soft plushie doll.", 
    emoji: "🧸",
    description: "Converts your subject into a cuddly, soft plushie toy."
  },
  { 
    title: "Acrylic Keychain", 
    prompt: "Turn the subject into a cute acrylic keychain, shown attached to a bag.", 
    emoji: "🔑",
    description: "Creates a cute acrylic keychain of your subject, perfect for hanging on a bag."
  },
  
  // Photorealistic & Enhancement
  { 
    title: "HD Enhance", 
    prompt: "Enhance this image to high resolution, improving sharpness and clarity.", 
    emoji: "🔍",
    description: "Upscales your image, adding sharpness, clarity, and detail for a high-res look."
  },
  { 
    title: "Pose Reference", 
    prompt: "Apply the pose from the second image to the character in the first image. Render as a professional studio photograph.",
    emoji: "💃",
    description: "Applies a pose from one image to a character from another.",
    isMultiImage: true,
    primaryUploaderTitle: "Character",
    primaryUploaderDescription: "The main character",
    secondaryUploaderTitle: "Pose Reference",
    secondaryUploaderDescription: "The pose to apply",
  },
  { 
    title: "To Photorealistic", 
    prompt: "Turn this illustration into a photorealistic version.", 
    emoji: "🪄",
    description: "Converts drawings or illustrations into stunningly realistic photos."
  },
  { 
    title: "Fashion Magazine", 
    prompt: "Transform the photo into a stylized, ultra-realistic fashion magazine portrait with cinematic lighting.", 
    emoji: "📸",
    description: "Gives your photo a high-fashion, editorial look worthy of a magazine cover."
  },
  { 
    title: "Hyper-realistic", 
    prompt: "Generate a hyper-realistic, fashion-style photo with strong, direct flash lighting, grainy texture, and a cool, confident pose.", 
    emoji: "✨",
    description: "Applies a gritty, direct-flash photography style for a cool, hyper-realistic vibe."
  },

  // Design & Product
  { 
    title: "Architecture Model", 
    prompt: "Convert this photo of a building into a miniature architecture model, placed on a cardstock in an indoor setting. Show a computer with modeling software in the background.", 
    emoji: "🏗️",
    description: "Transforms a building into a detailed miniature architectural model."
  },
  { 
    title: "Product Render", 
    prompt: "Turn this product sketch into a photorealistic 3D render with studio lighting.", 
    emoji: "💡",
    description: "Turns a product sketch into a professional, photorealistic 3D render."
  },
  { 
    title: "Soda Can Design", 
    prompt: "Design a soda can using this image as the main graphic, and show it in a professional product shot.", 
    emoji: "🥤",
    description: "Wraps your image onto a soda can and places it in a slick product shot."
  },
  { 
    title: "Industrial Design Render", 
    prompt: "Turn this industrial design sketch into a realistic product photo, rendered with light brown leather and displayed in a minimalist museum setting.", 
    emoji: "🛋️",
    description: "Renders an industrial design sketch as a real product in a museum setting."
  },

  // Artistic & Stylistic
  { 
    title: "Color Palette Swap",
    prompt: "Turn this image into a clean, hand-drawn line art sketch.", // Step 1 prompt
    stepTwoPrompt: "Color the line art using the colors from the second image.", // Step 2 prompt
    emoji: "🎨",
    description: "Converts an image to line art, then colors it using a second image as a palette.",
    isMultiImage: true,
    isTwoStep: true,
    primaryUploaderTitle: "Original Image",
    primaryUploaderDescription: "The image to transform",
    secondaryUploaderTitle: "Color Palette",
    secondaryUploaderDescription: "The color reference",
  },
  { 
    title: "Line Art Drawing", 
    prompt: "Turn the image into a clean, hand-drawn line art sketch.", 
    emoji: "✍🏻",
    description: "Reduces your photo to its essential lines, creating a clean sketch."
  },
  { 
    title: "Painting Process", 
    prompt: "Generate a 4-panel grid showing the artistic process of creating this image, from sketch to final render.", 
    emoji: "🖼️",
    description: "Shows a 4-step grid of your image being created, from sketch to final painting."
  },
  { 
    title: "Marker Sketch", 
    prompt: "Redraw the image in the style of a Copic marker sketch, often used in design.", 
    emoji: "🖊️",
    description: "Reimagines your photo as a vibrant sketch made with Copic markers."
  },
  { 
    title: "Add Illustration", 
    prompt: "Add a cute, cartoon-style illustrated couple into the real-world scene, sitting and talking.", 
    emoji: "🧑‍🎨",
    description: "Adds charming, hand-drawn characters into your real-world photo."
  },
  { 
    title: "Cyberpunk", 
    prompt: "Transform the scene into a futuristic cyberpunk city.", 
    emoji: "🤖",
    description: "Transforms your scene into a neon-drenched, futuristic cyberpunk city."
  },
  { 
    title: "Van Gogh Style", 
    prompt: "Reimagine the photo in the style of Van Gogh's 'Starry Night'.", 
    emoji: "🌌",
    description: "Repaints your photo with the iconic, swirling brushstrokes of 'Starry Night'."
  },

  // Utility & Specific Edits
  { 
    title: "Isolate & Enhance", 
    prompt: "Isolate the person in the masked area and generate a high-definition photo of them against a neutral background.", 
    emoji: "🎯",
    description: "Cuts out a masked subject and creates a clean, high-definition portrait."
  },
  { 
    title: "3D Screen Effect", 
    prompt: "For an image with a screen, add content that appears to be glasses-free 3D, popping out of the screen.", 
    emoji: "📺",
    description: "Makes content on a screen in your photo appear to pop out in 3D."
  },
  { 
    title: "Makeup Analysis", 
    prompt: "Analyze the makeup in this photo and suggest improvements by drawing with a red pen.", 
    emoji: "💄",
    description: "Analyzes makeup in a portrait and suggests improvements with red-pen markup."
  },
  { 
    title: "Change Background", 
    prompt: "Change the background to a Y2K aesthetic style.", 
    emoji: "🪩",
    description: "Swaps the existing background for a cool, retro Y2K aesthetic."
  },
];