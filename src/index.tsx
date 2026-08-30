import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";

import { App } from "./app";
import { isWeb } from "./platform/detect";

async function bootstrap() {
  let captureRecoverableError: ((error: unknown, componentStack?: string) => void) | undefined;
  if (__BIU_SENTRY_ENABLED__) {
    try {
      const monitoring = await import("./monitoring");
      if (monitoring.initBrowserMonitoring()) captureRecoverableError = monitoring.captureRecoverableReactError;
    } catch (error) {
      console.error("[monitoring] browser initialization failed", error);
    }
  }

  if (!isWeb) document.documentElement.dataset.hoverEffects = "enabled";

  createRoot(document.getElementById("root") as Element, {
    onRecoverableError: captureRecoverableError
      ? (error, info) => captureRecoverableError?.(error, info.componentStack ?? undefined)
      : undefined,
  }).render(
    <HashRouter>
      <App />
    </HashRouter>,
  );
}

void bootstrap();
