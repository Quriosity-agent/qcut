import React from "react";
import ReactDOM from "react-dom/client";
import "./globals.css";
import App from "./App";

// Development memory profiler
if (import.meta.env.DEV) {
  void import("./lib/dev-memory-profiler");
}

// Blob URL monitoring intentionally disabled to comply with no-console policy.

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error('Root element "#root" not found');
}
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
