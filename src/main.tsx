import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { audioEngine } from "./lib/audio/AudioEngine";
import { AppProviders } from "./providers/AppProviders";
import { initializeTheme } from "./stores/theme-store";
import "./styles.css";

initializeTheme();

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    audioEngine.dispose();
  }, { once: true });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    audioEngine.dispose();
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
);
