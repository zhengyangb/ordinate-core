import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { failStartup } from "./platform/startupScreen";

class StartupErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { failStartup(error); }
  render() { return this.state.failed ? null : this.props.children; }
}
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <StartupErrorBoundary><App /></StartupErrorBoundary>
  </React.StrictMode>,
);
