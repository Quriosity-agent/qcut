# Infinite Loop Console Analysis v2 - With Source Maps

## Console Output with Source Files

### Timeline Component Debug Output
```javascript
// Source file: index.tsx (Timeline component)
[Timeline] Render #1 at 2025-08-18T14:20:18.866Z (11ms since last)
index.tsx:86 [Timeline] ⚠️ Rapid re-rendering detected! Only 11ms between renders
index.tsx:352 [Timeline] Duration update effect triggered
index.tsx:356 [Timeline] Setting duration from 0 to 10

[Timeline] Render #2 at 2025-08-18T14:20:18.869Z (3ms since last)
index.tsx:86 [Timeline] ⚠️ Rapid re-rendering detected! Only 3ms between renders
index.tsx:352 [Timeline] Duration update effect triggered
index.tsx:356 [Timeline] Setting duration from 0 to 10

[Timeline] Render #3 at 2025-08-18T14:20:18.874Z (5ms since last)
index.tsx:86 [Timeline] ⚠️ Rapid re-rendering detected! Only 5ms between renders
index.tsx:352 [Timeline] Duration update effect triggered
index.tsx:356 [Timeline] Setting duration from 10 to 10
index.tsx:362 [Timeline] Duration unchanged, skipping update
```

### ❌ INFINITE LOOP ERROR LOCATION
```
react-dom.development.js:86 Warning: Maximum update depth exceeded
at fl (file:///editor._project_id.lazy-ANPDWNVE.js:13:102864)
```

### Key Discovery: Source Maps Show Real Files!
- Timeline debug logs show **real file names** (`index.tsx`)
- Error still shows minified component `fl`
- This means `fl` is a component WITHOUT debug logging yet

## Component Hierarchy at Error
```
So (root)
└── Suspense
    └── U8
        └── BU
            └── HU
                └── Suspense
                    └── $U
                        └── pl
                            └── li (component)
                                └── forwardRef(PanelGroup)
                                    └── forwardRef(Panel)
                                        └── jc (component)
                                            └── div
                                                └── fl ← ERROR HERE!
```

## Analysis Results

### ✅ CONFIRMED: Timeline is NOT the Problem
- Timeline only renders 13 times total
- Initial rapid renders (1-3) are normal mounting behavior
- Stabilizes after render #3
- **No infinite loop in Timeline component**

### 🔍 Component `fl` Identification Strategy

Since we have source maps and Timeline shows real file names, but `fl` doesn't, this means:
1. Component `fl` doesn't have our debug logging yet
2. It's nested inside a Panel component
3. It's likely one of these panel children:
   - Preview panel content
   - Media panel views
   - Properties panel content
   - Playback controls

## Next Debugging Steps

### 1. Add Debug Logging to Panel Children

```typescript
// Add this to EVERY component inside panels:
const componentName = "ComponentName"; // Change this!
const renderCount = useRef(0);
const lastRenderTime = useRef(Date.now());

useEffect(() => {
  renderCount.current++;
  const now = Date.now();
  const timeSince = now - lastRenderTime.current;
  lastRenderTime.current = now;
  
  console.log(`[${componentName}] Render #${renderCount.current} at ${new Date().toISOString()} (${timeSince}ms since last)`);
  
  if (timeSince < 50) {
    console.warn(`[${componentName}] ⚠️ Rapid re-rendering detected! Only ${timeSince}ms between renders`);
  }
  
  if (renderCount.current > 100) {
    console.error(`[${componentName}] ❌ EXCESSIVE RENDERS: ${renderCount.current} renders detected!`);
    console.trace();
  }
});
```

### 2. Priority Files to Add Logging

#### HIGHEST PRIORITY (Inside Panels)
1. **Preview Panel Components**
   - `components/editor/preview-panel.tsx`
   - `components/editor/preview-panel-components.tsx`
   - `components/ui/video-player.tsx`

2. **Media Panel Views**
   - `components/editor/media-panel/views/media.tsx`
   - `components/editor/media-panel/views/sounds.tsx`
   - `components/editor/media-panel/views/stickers.tsx`

3. **Properties Panel**
   - `components/editor/properties-panel/index.tsx`

4. **Playback Controls**
   - Any component showing play/pause buttons
   - Time display components

### 3. Common Patterns That Cause Infinite Loops

#### Pattern 1: Video/Audio currentTime Updates
```typescript
// PROBLEM: Updates 30-60 times per second!
useEffect(() => {
  const interval = setInterval(() => {
    setTime(video.currentTime);
  }, 16); // 60fps updates
  return () => clearInterval(interval);
}, [video]);
```

#### Pattern 2: ResizeObserver Without Debouncing
```typescript
// PROBLEM: Can fire rapidly during resize
useEffect(() => {
  const observer = new ResizeObserver((entries) => {
    setSize({ width: entries[0].contentRect.width });
  });
  observer.observe(element);
}, []);
```

#### Pattern 3: Store Subscription to Frequently Changing Values
```typescript
// PROBLEM: currentTime changes constantly during playback
const currentTime = usePlaybackStore(s => s.currentTime);
useEffect(() => {
  updateSomething(currentTime);
}, [currentTime]); // Fires 30-60 times per second!
```

## Action Plan

### Step 1: Add Logging (5 minutes)
Add the debug logging code to these files:
- [ ] `preview-panel.tsx`
- [ ] `preview-panel-components.tsx`
- [ ] `video-player.tsx`
- [ ] `properties-panel/index.tsx`
- [ ] All media panel views

### Step 2: Run and Identify (2 minutes)
```bash
cd qcut && bun run electron:dev
```
Look for component with 100+ renders

### Step 3: Fix the Issue (5 minutes)
Once identified, apply one of these fixes:
- Add debouncing/throttling
- Use React.memo
- Fix useEffect dependencies
- Remove unnecessary state updates

## Expected Console Output After Adding Logging

You should see something like:
```
[Timeline] Render #1-#13 (already visible)
[PreviewPanel] Render #1
[MediaPanel] Render #1
[PropertiesPanel] Render #1
[SomeComponent] Render #1
[SomeComponent] Render #2
[SomeComponent] Render #3
... (if this keeps going to 100+, you found it!)
[SomeComponent] ❌ EXCESSIVE RENDERS: 101 renders detected!
```

The component that shows excessive renders is your `fl` component!