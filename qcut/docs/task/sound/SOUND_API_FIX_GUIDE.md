# Sound API Fix Guide

## Problem Description

The sound search functionality is failing with:
```
/C:/api/sounds/search?q=water&type=effects&page=1&commercial_only=true:1  Failed to load resource: net::ERR_FILE_NOT_FOUND
```

This error occurs because:
1. The app is trying to fetch from `/api/sounds/search` (Next.js API route pattern)
2. However, QCut is a **Vite + Electron** application, not Next.js
3. In Electron, there's no backend server to handle `/api/` routes
4. The fetch is being treated as a file system path, hence `net::ERR_FILE_NOT_FOUND`

## Root Cause Analysis

### Current Architecture Issue
- **Frontend**: Vite + TanStack Router (client-side only)
- **Backend**: None (pure frontend app packaged with Electron)
- **Sound Hook**: `use-sound-search.ts` calls `fetch('/api/sounds/search')` 
- **API Route**: `apps/web/src/app/api/sounds/search/route.ts` exists but won't work in Vite

### Why This Happens
1. The sound search hook was designed for Next.js (which has API routes)
2. QCut uses Vite, which doesn't support server-side API routes
3. Electron apps need IPC (Inter-Process Communication) for backend functionality

## Solution Options

### Option 1: Electron IPC Handler (Recommended)
**Pros**: Keeps API key secure, works offline, no external dependencies
**Cons**: Electron-specific, requires main process changes

#### Implementation Steps:
1. **Add environment variables to Electron main process**
2. **Create IPC handler for sound search**
3. **Update frontend hook to use IPC instead of fetch**

### Option 2: External Backend Service
**Pros**: Could work for web deployment later
**Cons**: Requires separate server, API key exposure risk

### Option 3: Direct Frontend API Calls
**Pros**: Simple to implement
**Cons**: Exposes API key, CORS issues, security risk

## Recommended Fix (Option 1: Electron IPC)

### Step 1: Environment Setup
```javascript
// electron/main.js - Add at top
require('dotenv').config({ path: path.join(__dirname, '../apps/web/.env.local') });
```

### Step 2: Add IPC Handler
```javascript
// electron/main.js - Add IPC handler
ipcMain.handle("sounds:search", async (event, searchParams) => {
  const FREESOUND_API_KEY = process.env.FREESOUND_API_KEY;
  if (!FREESOUND_API_KEY) {
    return { success: false, error: "API key not configured" };
  }
  
  // Make HTTPS request to Freesound API
  // Transform and return results
});
```

### Step 3: Update Frontend Hook
```javascript
// hooks/use-sound-search.ts - Replace fetch calls
const response = await window.electronAPI.invoke('sounds:search', {
  q: query,
  type: "effects",
  page: 1,
  commercial_only: commercialOnly,
});
```

### Step 4: Environment Variables
```bash
# apps/web/.env.local
FREESOUND_API_KEY=your_api_key_here
```

## Implementation Checklist

### Prerequisites
- [ ] Freesound API key obtained from freesound.org
- [ ] `dotenv` package installed
- [ ] Understanding of Electron IPC

### Main Process Changes
- [ ] Add environment variable loading
- [ ] Create `sounds:search` IPC handler  
- [ ] Handle HTTPS requests to Freesound API
- [ ] Transform API responses to match frontend expectations
- [ ] Add error handling

### Frontend Changes  
- [ ] Update `use-sound-search.ts` to use IPC
- [ ] Replace `fetch('/api/sounds/search')` calls
- [ ] Update error handling for IPC responses
- [ ] Add TypeScript types for IPC calls

### Testing
- [ ] Verify API key loading
- [ ] Test sound search functionality
- [ ] Test error handling (no API key, network errors)
- [ ] Test in both development and production builds

## File Structure After Fix

```
qcut/
├── electron/
│   ├── main.js (+ IPC handler, env loading)
│   └── preload.js (IPC exposure already exists)
├── apps/web/
│   ├── .env.local (+ FREESOUND_API_KEY)
│   ├── src/hooks/
│   │   └── use-sound-search.ts (updated to use IPC)
│   └── src/app/api/ (can be removed - not needed)
```

## Security Considerations

### ✅ Secure (Recommended)
- API key stored in Electron main process
- No API key exposure to renderer process
- IPC communication between processes

### ❌ Insecure (Avoid)
- API key in frontend environment variables
- Direct API calls from renderer process
- API key visible in DevTools/source code

## Debugging Tips

### Common Issues
1. **Environment variables not loading**: Check file path and dotenv config
2. **IPC handler not found**: Verify handler name matches frontend call
3. **API key not working**: Test key manually with curl/Postman
4. **HTTPS errors**: Check network connectivity and SSL certificates

### Debug Logging
```javascript
// Temporary debug logs
console.log("API key loaded:", !!process.env.FREESOUND_API_KEY);
console.log("IPC call received:", searchParams);
```

## Expected Behavior After Fix

### Before Fix
```
❌ /C:/api/sounds/search - net::ERR_FILE_NOT_FOUND
❌ No sound results
❌ Error messages in console
```

### After Fix  
```
✅ IPC call to main process
✅ HTTPS request to Freesound API
✅ Sound results displayed
✅ Audio preview working
```

## Alternative Architectures (Future)

If QCut ever moves to a different architecture:
- **Next.js**: Current API route would work as-is
- **Express + Vite**: Create Express server with `/api/sounds/search` endpoint  
- **Tauri**: Use Tauri commands instead of Electron IPC
- **PWA**: Use service worker for API proxy (with CORS considerations)

## Resources

- [Electron IPC Documentation](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Freesound API Documentation](https://freesound.org/docs/api/)
- [Vite vs Next.js Architecture Differences](https://vitejs.dev/guide/)

---

**Note**: This fix maintains the existing UI/UX while properly implementing the backend functionality for Electron environment.