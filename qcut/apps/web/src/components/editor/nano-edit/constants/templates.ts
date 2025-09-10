// Template definitions for nano-edit asset generation
export interface AssetTemplate {
  id: string;
  name: string;
  prompt: string;
  dimensions: string;
  category: string;
  description?: string;
}

export const THUMBNAIL_TEMPLATES: AssetTemplate[] = [
  {
    id: "youtube-gaming",
    name: "Gaming YouTube",
    prompt:
      "Vibrant gaming thumbnail with colorful effects, dynamic action, bright colors, high energy",
    dimensions: "1280x720",
    category: "gaming",
    description: "Perfect for gaming content with high-energy visuals",
  },
  {
    id: "youtube-tutorial",
    name: "Tutorial/Educational",
    prompt:
      "Clean educational thumbnail, professional layout, clear text space, informative design",
    dimensions: "1280x720",
    category: "education",
    description: "Ideal for how-to and educational videos",
  },
  {
    id: "youtube-vlog",
    name: "Personal Vlog",
    prompt:
      "Personal vlog thumbnail, warm friendly colors, casual aesthetic, authentic feel",
    dimensions: "1280x720",
    category: "lifestyle",
    description: "Great for personal vlogs and lifestyle content",
  },
  {
    id: "youtube-tech",
    name: "Tech Review",
    prompt:
      "Modern tech thumbnail, sleek design, product showcase, professional tech aesthetic",
    dimensions: "1280x720",
    category: "technology",
    description: "Perfect for tech reviews and product showcases",
  },
];

export const TITLE_CARD_TEMPLATES: AssetTemplate[] = [
  {
    id: "cinematic-dark",
    name: "Cinematic Dark",
    prompt:
      "Dark cinematic title card, dramatic lighting, movie-style design, premium feel",
    dimensions: "1920x1080",
    category: "cinematic",
    description: "Professional cinematic look for high-end content",
  },
  {
    id: "corporate-clean",
    name: "Corporate Clean",
    prompt:
      "Clean corporate title card, minimal design, professional colors, business aesthetic",
    dimensions: "1920x1080",
    category: "business",
    description: "Perfect for corporate and business content",
  },
  {
    id: "retro-synthwave",
    name: "Retro Synthwave",
    prompt:
      "Retro 80s synthwave title card, neon colors, cyberpunk aesthetic, nostalgic vibe",
    dimensions: "1920x1080",
    category: "retro",
    description: "Nostalgic 80s vibe for creative content",
  },
  {
    id: "minimal-modern",
    name: "Minimal Modern",
    prompt:
      "Minimal modern title card, clean typography, subtle effects, contemporary design",
    dimensions: "1920x1080",
    category: "minimal",
    description: "Clean and modern for any type of content",
  },
];

export const LOGO_TEMPLATES: AssetTemplate[] = [
  {
    id: "tech-startup",
    name: "Tech Startup",
    prompt:
      "Modern tech startup logo, clean lines, innovative design, professional tech aesthetic",
    dimensions: "512x512",
    category: "technology",
    description: "Perfect for tech companies and startups",
  },
  {
    id: "coffee-shop",
    name: "Coffee Shop",
    prompt:
      "Warm coffee shop logo, cozy aesthetic, coffee elements, inviting design",
    dimensions: "512x512",
    category: "food",
    description: "Great for cafes and food businesses",
  },
  {
    id: "gaming-team",
    name: "Gaming Team",
    prompt:
      "Gaming team logo, esports style, bold design, competitive aesthetic",
    dimensions: "512x512",
    category: "gaming",
    description: "Ideal for gaming teams and esports",
  },
  {
    id: "creative-studio",
    name: "Creative Studio",
    prompt:
      "Creative studio logo, artistic design, innovative branding, creative industry aesthetic",
    dimensions: "512x512",
    category: "creative",
    description: "Perfect for creative agencies and studios",
  },
];

// Helper function to get templates by category
export const getTemplatesByCategory = (
  templates: AssetTemplate[],
  category: string
) => {
  return templates.filter((template) => template.category === category);
};

// Helper function to get all categories
export const getCategories = (templates: AssetTemplate[]) => {
  const categories = new Set(templates.map((template) => template.category));
  return Array.from(categories);
};
