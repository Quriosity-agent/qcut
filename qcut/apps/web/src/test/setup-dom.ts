import { beforeAll } from "vitest";

beforeAll(async () => {
  // This should be handled by jsdom environment, but let's be explicit
  if (typeof document === "undefined") {
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    
    // Make DOM globals available
    global.document = dom.window.document;
    global.window = dom.window as any;
    global.navigator = dom.window.navigator;
    global.HTMLElement = dom.window.HTMLElement;
    global.Element = dom.window.Element;
    global.Node = dom.window.Node;
    
    // Mock additional APIs
    global.URL = dom.window.URL;
    global.location = dom.window.location;
    
    console.log("Manual DOM setup completed");
  }
});