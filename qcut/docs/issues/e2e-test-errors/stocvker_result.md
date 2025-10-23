should access stickers panel and interact with sticker items
sticker-overlay-testing.e2e.ts:20
26.0s
electron
Copy prompt
TimeoutError: page.waitForSelector: Timeout 10000ms exceeded.
Call log:
  - waiting for locator('[data-testid="timeline-track"], [data-testid="editor-container"]') to be visible


   at helpers\electron-helpers.ts:214

  212 |   } else {
  213 |     // No modal - direct navigation, wait for editor elements
> 214 |     await page.waitForSelector(
      |                ^
  215 |       '[data-testid="timeline-track"], [data-testid="editor-container"]',
  216 |       { timeout: 10_000 }
  217 |     );
    at createTestProject (C:\Users\zdhpe\Desktop\vite_opencut\OpenCut-main\qcut\apps\web\src\test\e2e\helpers\electron-helpers.ts:214:16)
    at C:\Users\zdhpe\Desktop\vite_opencut\OpenCut-main\qcut\apps\web\src\test\e2e\sticker-overlay-testing.e2e.ts:25:5

Sticker Overlay Testing (Subtask 3A)
« previous
next »
should support sticker drag and drop to canvas
sticker-overlay-testing.e2e.ts:67
25.7s
electron
Copy prompt
TimeoutError: page.waitForSelector: Timeout 10000ms exceeded.
Call log:
  - waiting for locator('[data-testid="timeline-track"], [data-testid="editor-container"]') to be visible


   at helpers\electron-helpers.ts:214

  212 |   } else {
  213 |     // No modal - direct navigation, wait for editor elements
> 214 |     await page.waitForSelector(
      |                ^
  215 |       '[data-testid="timeline-track"], [data-testid="editor-container"]',
  216 |       { timeout: 10_000 }
  217 |     );
    at createTestProject (C:\Users\zdhpe\Desktop\vite_opencut\OpenCut-main\qcut\apps\web\src\test\e2e\helpers\electron-helpers.ts:214:16)
    at C:\Users\zdhpe\Desktop\vite_opencut\OpenCut-main\qcut\apps\web\src\test\e2e\sticker-overlay-testing.e2e.ts:68:5

    TimeoutError: page.waitForSelector: Timeout 10000ms exceeded.
Call log:
  - waiting for locator('[data-testid="timeline-track"], [data-testid="editor-container"]') to be visible


   at helpers\electron-helpers.ts:214

  212 |   } else {
  213 |     // No modal - direct navigation, wait for editor elements
> 214 |     await page.waitForSelector(
      |                ^
  215 |       '[data-testid="timeline-track"], [data-testid="editor-container"]',
  216 |       { timeout: 10_000 }
  217 |     );
    at createTestProject (C:\Users\zdhpe\Desktop\vite_opencut\OpenCut-main\qcut\apps\web\src\test\e2e\helpers\electron-helpers.ts:214:16)
    at C:\Users\zdhpe\Desktop\vite_opencut\OpenCut-main\qcut\apps\web\src\test\e2e\sticker-overlay-testing.e2e.ts:170:5
3.3sBefore Hooks
1.6sWait for selector locator('[data-testid="new-project-button"], [data-testid="new-project-button-mobile"], [data-testid="new-project-button-empty-state"]')— helpers/electron-helpers.ts:169
1msWait for load state "domcontentloaded"— helpers/electron-helpers.ts:175
252msQuery count getByTestId('new-project-button-empty-state')— helpers/electron-helpers.ts:179
255msQuery count locator('[data-testid="new-project-button"]:visible, [data-testid="new-project-button-mobile"]:visible').first()— helpers/electron-helpers.ts:193
3.1sClick locator('[data-testid="new-project-button"]:visible, [data-testid="new-project-button-mobile"]:visible').first()— helpers/electron-helpers.ts:194
10.0sWait for selector locator('[data-testid="timeline-track"], [data-testid="editor-container"]')— helpers/electron-helpers.ts:214
5.2sAfter Hooks
2msWorker Cleanup

Sticker Overlay Testing (Subtask 3A)
« previous
next »
should handle sticker panel categories and search
sticker-overlay-testing.e2e.ts:251
24.8s
electron
Copy prompt
TimeoutError: page.waitForSelector: Timeout 10000ms exceeded.
Call log:
  - waiting for locator('[data-testid="timeline-track"], [data-testid="editor-container"]') to be visible


   at helpers\electron-helpers.ts:214

  212 |   } else {
  213 |     // No modal - direct navigation, wait for editor elements
> 214 |     await page.waitForSelector(
      |                ^
  215 |       '[data-testid="timeline-track"], [data-testid="editor-container"]',
  216 |       { timeout: 10_000 }
  217 |     );
    at createTestProject (C:\Users\zdhpe\Desktop\vite_opencut\OpenCut-main\qcut\apps\web\src\test\e2e\helpers\electron-helpers.ts:214:16)
    at C:\Users\zdhpe\Desktop\vite_opencut\OpenCut-main\qcut\apps\web\src\test\e2e\sticker-overlay-testing.e2e.ts:254:5
3.8sBefore Hooks
1.6sWait for selector locator('[data-testid="new-project-button"], [data-testid="new-project-button-mobile"], [data-testid="new-project-button-empty-state"]')— helpers/electron-helpers.ts:169
0msWait for load state "domcontentloaded"— helpers/electron-helpers.ts:175
295msQuery count getByTestId('new-project-button-empty-state')— helpers/electron-helpers.ts:179
279msQuery count locator('[data-testid="new-project-button"]:visible, [data-testid="new-project-button-mobile"]:visible').first()— helpers/electron-helpers.ts:193
2.9sClick locator('[data-testid="new-project-button"]:visible, [data-testid="new-project-button-mobile"]:visible').first()— helpers/electron-helpers.ts:194
10.0sWait for selector locator('[data-testid="timeline-track"], [data-testid="editor-container"]')— helpers/electron-helpers.ts:214
5.6sAfter Hooks
4msWorker Cleanup