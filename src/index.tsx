import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";

import { App } from "./app";
import { isWeb } from "./platform/detect";

if (!isWeb) {
  document.documentElement.dataset.hoverEffects = "enabled";
}

const root = createRoot(document.getElementById("root") as Element);
root.render(
  <HashRouter>
    <App />
  </HashRouter>,
);
