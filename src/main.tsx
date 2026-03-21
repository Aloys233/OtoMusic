import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { AppProviders } from "./providers/AppProviders";
import { initializeTheme } from "./stores/theme-store";
import "./styles.css";

initializeTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
);
