/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost:3000",
        beforeParse(window: any) {
          // Inject getComputedStyle immediately when JSDOM window is created
          const mockGetComputedStyle = (element: Element): CSSStyleDeclaration => {
            const styles: any = {
              getPropertyValue: (prop: string) => {
                const mappings: Record<string, string> = {
                  'display': 'block', 'visibility': 'visible', 'opacity': '1', 'transform': 'none',
                  'transition': 'none', 'animation': 'none', 'position': 'static', 'top': 'auto',
                  'left': 'auto', 'right': 'auto', 'bottom': 'auto', 'width': 'auto', 'height': 'auto',
                  'margin': '0px', 'padding': '0px', 'border': '0px', 'background': 'transparent'
                };
                return mappings[prop] || "";
              },
              setProperty: () => {}, removeProperty: () => "", item: () => "", length: 0,
              parentRule: null, cssFloat: "", cssText: "", display: "block", visibility: "visible", 
              opacity: "1", transform: "none", transition: "none", animation: "none", position: "static",
              top: "auto", left: "auto", right: "auto", bottom: "auto", width: "auto", height: "auto"
            };
            Object.defineProperty(styles, Symbol.iterator, { value: function* () { for (let i = 0; i < this.length; i++) yield this.item(i); }});
            return styles as CSSStyleDeclaration;
          };
          
          // Apply polyfill to window immediately
          window.getComputedStyle = mockGetComputedStyle;
          
          // Add requestAnimationFrame
          window.requestAnimationFrame = window.requestAnimationFrame || ((callback: FrameRequestCallback) => window.setTimeout(callback, 16));
          window.cancelAnimationFrame = window.cancelAnimationFrame || ((id: number) => window.clearTimeout(id));
          
          // Set up globals immediately
          if (typeof globalThis !== 'undefined') {
            globalThis.getComputedStyle = mockGetComputedStyle;
            globalThis.requestAnimationFrame = window.requestAnimationFrame;
            globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
          }
          if (typeof global !== 'undefined') {
            (global as any).getComputedStyle = mockGetComputedStyle;
            (global as any).requestAnimationFrame = window.requestAnimationFrame;
            (global as any).cancelAnimationFrame = window.cancelAnimationFrame;
          }
        },
        
        afterParse(window: any) {
          // Set up document global after parsing
          if (typeof globalThis !== 'undefined') {
            globalThis.document = window.document;
            globalThis.window = window;
          }
          if (typeof global !== 'undefined') {
            (global as any).document = window.document;
            (global as any).window = window;
          }
        }
      }
    },
    globalSetup: path.resolve(rootDir, "src/test/global-setup.ts"),
    setupFiles: [
      path.resolve(rootDir, "src/test/preload-polyfills.ts"),
      path.resolve(rootDir, "src/test/setup.ts")
    ],
    isolate: true,
    pool: "forks",
    testTimeout: 5000,
    hookTimeout: 5000,
  },
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
});
