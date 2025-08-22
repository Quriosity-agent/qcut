// Default API keys for packaged app (can be overridden by user)
// These are fallback keys for when users haven't configured their own
module.exports = {
  // Default Freesound API key - limited rate
  // Users should get their own key from https://freesound.org/help/developers/
  // This is a demo key with rate limits - replace with your own for production
  FREESOUND_API_KEY: process.env.FREESOUND_API_KEY || 'xZuDmtp5P1GQZCLvRvJPJZs92xRuAg0NJXloKyNv',
  
  // FAL AI API key - no default provided
  // Users must configure their own at https://fal.ai
  FAL_API_KEY: process.env.FAL_API_KEY || ''
};