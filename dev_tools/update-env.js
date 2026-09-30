import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";

const fields = new Set([
  "BIU_UPDATE_PUBLISH_HOST",
  "BIU_UPDATE_PUBLISH_USER",
  "BIU_UPDATE_REMOTE_DIR",
  "BIU_UPDATE_PUBLIC_ORIGIN",
  "BIU_UPDATE_PUBLISH_KEY",
  "BIU_UPDATE_SIGNING_KEY",
  "SSH_AUTH_SOCK",
]);

/** Load only release settings, never execute the file or import unrelated Node options. */
export function loadUpdateEnvironment({ environment = process.env, homeDirectory = os.homedir() } = {}) {
  const filename = path.join(homeDirectory, ".config", "biu", "production.env");
  if (!fs.existsSync(filename)) return false;
  const values = parseEnv(fs.readFileSync(filename, "utf8"));
  for (const [name, value] of Object.entries(values)) {
    if (fields.has(name) && environment[name] === undefined) environment[name] = value;
  }
  return true;
}
