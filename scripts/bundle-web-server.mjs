import { build } from "esbuild";
import { rename, rm } from "node:fs/promises";
import path from "node:path";

const entry = path.resolve("dist/server/web-server/index.js");
const bundledEntry = path.resolve("dist/server/web-server/index.sentry-bundle.js");

// Release packages ship only dist/, so the Web server's runtime dependencies must travel with its entry.
await build({
  bundle: true,
  entryPoints: [entry],
  format: "esm",
  outfile: bundledEntry,
  packages: "bundle",
  platform: "node",
  sourcemap: false,
  target: "node22",
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});

await rm(entry, { force: true });
await rm(`${entry}.map`, { force: true });
await rename(bundledEntry, entry);
