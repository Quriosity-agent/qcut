// Minimal DOM setup for Vitest
const { JSDOM } = require("jsdom");

console.log("Minimal setup loading...");

// Create JSDOM instance
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');

// Set globals on both global and globalThis
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.location = dom.window.location;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.location = dom.window.location;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;

console.log("Minimal setup complete - document available:", typeof document !== "undefined");