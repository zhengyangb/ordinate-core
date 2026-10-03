import "./app.css";
import "./platform/desktopChrome.css";
import "./startup.css";
import { resolveInitialThemeMode } from "./platform/themePreference";
import { failStartup } from "./platform/startupScreen";

// Keep the initial entry small: paint the shell before parsing React/the grid.
try {
  document.documentElement.dataset.theme = resolveInitialThemeMode();
  if (window.ordinateDesktop) {
    document.documentElement.dataset.windowChrome = window.ordinateDesktop.windowChrome;
  }
  performance.mark("ordinate:bootstrap");
  void import("./main").catch(failStartup);
} catch (error) {
  failStartup(error);
}
