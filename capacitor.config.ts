import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.biu.app",
  appName: "Biu",
  webDir: "dist/web",
  server: {
    androidScheme: "https",
  },
};

export default config;
