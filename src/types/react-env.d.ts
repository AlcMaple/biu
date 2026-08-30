/// <reference types="@rsbuild/core/types" />

declare module "*.svg" {
  import type * as React from "react";

  export const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement> & { title?: string }>;
}

interface Window {
  __biuMonitoring?: {
    captureException: (error: unknown, componentStack?: string) => void;
    captureMessage: (message: string, level?: "debug" | "info" | "log" | "warning" | "error" | "fatal") => void;
    setUser: (user: { id: string; username?: string } | null) => void;
  };
}

declare const __BIU_SENTRY_ENABLED__: boolean;
