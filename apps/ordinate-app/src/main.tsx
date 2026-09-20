import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./app.css";
import "./platform/desktopChrome.css";

if (window.ordinateDesktop) {
  document.documentElement.dataset.windowChrome = window.ordinateDesktop.windowChrome;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
