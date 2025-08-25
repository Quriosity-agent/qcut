// Default API keys for packaged app (can be overridden by user)
// These are fallback keys for when users haven't configured their own
module.exports = {
  // Default Freesound API key
  // IMPORTANT: Replace with a valid API key or leave empty
  // Users should get their own key from https://freesound.org/help/developers/
  // To get a key:
  // 1. Create account at https://freesound.org/home/register/
  // 2. Go to https://freesound.org/apiv2/apply/
  // 3. Fill out the form (takes 1 minute)
  // 4. Copy your API key
  FREESOUND_API_KEY:
    process.env.FREESOUND_API_KEY || "h650BnTkps2suLENRVXD8LdADgrYzVm1dQxmxQqc", // Working default key

  // FAL AI API key - no default provided
  // Users must configure their own at https://fal.ai
  FAL_API_KEY: process.env.FAL_API_KEY || "",
};
