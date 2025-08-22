# Freesound API Implementation Plan - Production Ready Solution

## Overview
This document outlines the implementation plan to fix the Freesound API integration issue in the packaged Windows exe. The solution combines:
1. Using the existing API key settings UI
2. Adding a default embedded API key fallback
3. Ensuring backward compatibility

## Current State Analysis

### Existing Infrastructure
- ✅ **API Key Settings UI**: Already exists at `settings-view.tsx:266-406`
- ✅ **Secure Storage**: Already implemented in `api-key-handler.js`
- ✅ **IPC Handlers**: Already set up for API key management
- ❌ **Sound Handler Integration**: Not using stored API keys
- ❌ **Default Fallback**: No default API key for packaged apps

## Implementation Subtasks

### Task 1: Add Default API Key Configuration (5 minutes)
**File**: `electron/config/default-keys.js` (NEW)
**Time**: 5 minutes
**Dependencies**: None

```javascript
// Default API keys for packaged app (can be overridden by user)
module.exports = {
  // Default community key with rate limits
  // Users should get their own key from https://freesound.org/help/developers/
  FREESOUND_API_KEY: process.env.FREESOUND_API_KEY || 'YOUR_DEFAULT_KEY_HERE',
  FAL_API_KEY: process.env.FAL_API_KEY || ''
};
```

**Actions**:
1. Create new config directory
2. Add default-keys.js with fallback keys
3. Use environment variable if available, otherwise use embedded default

---

### Task 2: Update Sound Handler to Use Stored Keys (8 minutes)
**File**: `electron/sound-handler.js`
**Time**: 8 minutes
**Dependencies**: Task 1

**Changes**:
1. Import api-key-handler functions
2. Check stored user keys first
3. Fall back to default keys
4. Fall back to environment variables

```javascript
// Add at top of setupSoundIPC function
async function getFreesoundApiKey() {
  // Priority order:
  // 1. User-configured key from settings
  // 2. Default embedded key
  // 3. Environment variable (dev mode)
  
  try {
    // Try user-configured key first
    const { app, safeStorage } = require("electron");
    const userDataPath = app.getPath("userData");
    const apiKeysFilePath = path.join(userDataPath, "api-keys.json");
    
    if (fs.existsSync(apiKeysFilePath)) {
      const encryptedData = JSON.parse(fs.readFileSync(apiKeysFilePath, "utf8"));
      if (encryptedData.freesoundApiKey) {
        // Decrypt if possible
        if (safeStorage.isEncryptionAvailable()) {
          try {
            return safeStorage.decryptString(Buffer.from(encryptedData.freesoundApiKey, "base64"));
          } catch (e) {
            return encryptedData.freesoundApiKey; // Plain text fallback
          }
        }
        return encryptedData.freesoundApiKey;
      }
    }
  } catch (error) {
    log.warn("[Sound Handler] Error reading stored API key:", error);
  }
  
  // Try default embedded key
  try {
    const defaultKeys = require("./config/default-keys");
    if (defaultKeys.FREESOUND_API_KEY) {
      return defaultKeys.FREESOUND_API_KEY;
    }
  } catch (error) {
    log.warn("[Sound Handler] No default keys available");
  }
  
  // Fall back to environment variable (development)
  return process.env.FREESOUND_API_KEY;
}
```

---

### Task 3: Add API Key Validation (7 minutes)
**File**: `electron/sound-handler.js`
**Time**: 7 minutes
**Dependencies**: Task 2

**Add new IPC handler**:
```javascript
// Test API key validity
ipcMain.handle("sounds:test-key", async (event, apiKey) => {
  try {
    const testUrl = `https://freesound.org/apiv2/search/text/?query=test&token=${apiKey}&page_size=1`;
    const response = await new Promise((resolve, reject) => {
      https.get(testUrl, (res) => {
        resolve({ statusCode: res.statusCode });
      }).on('error', reject);
    });
    
    return { 
      success: response.statusCode === 200,
      message: response.statusCode === 200 ? "API key is valid" : "Invalid API key"
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
});
```

---

### Task 4: Update Settings UI with Test Button (8 minutes)
**File**: `apps/web/src/components/editor/properties-panel/settings-view.tsx`
**Time**: 8 minutes
**Dependencies**: Task 3

**Changes**:
1. Add test connection button
2. Show validation status
3. Add loading state during test

```javascript
// Add after line 390 in ApiKeysView
const [isTestingFreesound, setIsTestingFreesound] = useState(false);
const [freesoundTestResult, setFreesoundTestResult] = useState(null);

const testFreesoundKey = async () => {
  setIsTestingFreesound(true);
  try {
    const result = await window.electronAPI.invoke("sounds:test-key", freesoundApiKey);
    setFreesoundTestResult(result);
  } catch (error) {
    setFreesoundTestResult({ success: false, message: "Test failed" });
  }
  setIsTestingFreesound(false);
};

// Add test button in UI
<Button 
  onClick={testFreesoundKey} 
  disabled={!freesoundApiKey || isTestingFreesound}
  variant="outline"
  size="sm"
>
  {isTestingFreesound ? "Testing..." : "Test"}
</Button>
```

---

### Task 5: Add First-Run Detection (5 minutes)
**File**: `electron/api-key-handler.js`
**Time**: 5 minutes
**Dependencies**: None

**Add new IPC handler**:
```javascript
// Check if this is first run (no keys configured)
ipcMain.handle("api-keys:is-first-run", async () => {
  try {
    if (!fs.existsSync(apiKeysFilePath)) {
      return true;
    }
    const data = JSON.parse(fs.readFileSync(apiKeysFilePath, "utf8"));
    return !data.freesoundApiKey && !data.falApiKey;
  } catch (error) {
    return true;
  }
});
```

---

### Task 6: Update Main Process Initialization (6 minutes)
**File**: `electron/main.js`
**Time**: 6 minutes
**Dependencies**: Tasks 1-5

**Changes**:
1. Setup API key handlers before sound handlers
2. Ensure proper initialization order

```javascript
// Update initialization order around line 40
setupApiKeyIPC();  // Must be first
setupSoundIPC();   // Can now use stored keys
setupThemeIPC();
setupFFmpegIPC();
```

---

### Task 7: Add Migration for Existing Users (7 minutes)
**File**: `electron/api-key-handler.js`
**Time**: 7 minutes
**Dependencies**: Task 5

**Add migration logic**:
```javascript
// Migrate from env to stored keys on first run
async function migrateEnvKeys() {
  const isFirstRun = await ipcMain.handle("api-keys:is-first-run");
  if (isFirstRun && process.env.FREESOUND_API_KEY) {
    // Auto-migrate env key to secure storage
    await ipcMain.handle("api-keys:set", null, {
      freesoundApiKey: process.env.FREESOUND_API_KEY,
      falApiKey: process.env.FAL_API_KEY || ""
    });
    log.info("[Migration] Migrated environment keys to secure storage");
  }
}
```

---

### Task 8: Add User Notification System (8 minutes)
**File**: `apps/web/src/components/editor/media-panel/views/sounds.tsx`
**Time**: 8 minutes
**Dependencies**: Tasks 1-7

**Changes**:
1. Show notification if no API key configured
2. Link to settings panel
3. Graceful degradation

```javascript
// Add at top of SoundEffectsView component
const [hasApiKey, setHasApiKey] = useState(true);

useEffect(() => {
  checkApiKeyStatus();
}, []);

const checkApiKeyStatus = async () => {
  if (window.electronAPI?.invoke) {
    const keys = await window.electronAPI.invoke("api-keys:get");
    setHasApiKey(!!keys.freesoundApiKey);
  }
};

// Show notification banner if no key
{!hasApiKey && (
  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded p-2 mb-4">
    <p className="text-sm">
      Sound search requires an API key. 
      <button onClick={() => /* navigate to settings */}>
        Configure in Settings → API Keys
      </button>
    </p>
  </div>
)}
```

---

### Task 9: Test in Development Mode (5 minutes)
**Time**: 5 minutes
**Dependencies**: Tasks 1-8

**Test Checklist**:
- [ ] Run `bun run electron:dev`
- [ ] Test with no API key (should show notification)
- [ ] Add API key in settings
- [ ] Test API key validation
- [ ] Verify sound search works
- [ ] Check console for errors

---

### Task 10: Test in Packaged App (10 minutes)
**Time**: 10 minutes
**Dependencies**: Task 9

**Test Checklist**:
- [ ] Build with `npx electron-packager`
- [ ] Run packaged exe
- [ ] Verify default key works (if configured)
- [ ] Test user key configuration
- [ ] Verify key persistence after restart
- [ ] Test sound search functionality

---

## Total Implementation Time: ~73 minutes

## Benefits of This Approach

1. **Immediate Fix**: Default key provides instant functionality
2. **User Control**: Settings UI allows users to use their own keys
3. **Secure Storage**: Keys are encrypted using Electron's safeStorage
4. **Backward Compatible**: Existing env variable approach still works
5. **Production Ready**: Works in both development and packaged apps
6. **Future Proof**: Easy to update default keys or add new APIs

## Security Considerations

1. **Default Key Rotation**: Can update default key in new releases
2. **Rate Limiting**: Default key should have appropriate rate limits
3. **User Keys Priority**: User-configured keys always take precedence
4. **Encrypted Storage**: Keys are encrypted on user's machine
5. **No Logging**: Keys are never logged in production

## Rollback Plan

If issues arise:
1. Remove default key configuration
2. Revert to environment-only approach
3. All user-configured keys remain intact
4. No data loss or breaking changes

## Success Metrics

- ✅ Sound search works in packaged app
- ✅ Users can configure their own API keys
- ✅ Keys persist across app restarts
- ✅ No security vulnerabilities introduced
- ✅ Existing development workflow unchanged