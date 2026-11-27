import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { createWindowsUpdateMetadata, getWindowsUpdateManifestFilename } from "../shared/update-signing.js";
import { signUpdateMetadata } from "./update-signature.js";

export function readUpdateYamlVersion(yaml) {
  return yaml
    .match(/^version:\s*([^\r\n]+)/m)?.[1]
    .trim()
    .replace(/^["']|["']$/g, "");
}

export function getDesktopReleaseArtifacts(artifactsDir, version, platform, { includePortable = false } = {}) {
  const mac = platform === "mac";
  const metadataName = mac ? "latest-mac.yml" : "latest.yml";
  const required = ["x64", "arm64"].flatMap(arch =>
    mac
      ? [`Biu-${version}-mac-${arch}.dmg`, `Biu-${version}-mac-${arch}.zip`]
      : [`Biu-${version}-win-setup-${arch}.exe`, `Biu-${version}-win-setup-${arch}.exe.blockmap`],
  );
  required.push(metadataName);
  if (!mac && includePortable) {
    required.push(...["x64", "arm64"].map(arch => `Biu-${version}-win-portable-${arch}.exe`));
  }
  const paths = required.map(name => path.join(artifactsDir, name));
  const absent = paths.filter(file => {
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    return !stat?.isFile() || stat.size === 0;
  });
  if (absent.length)
    throw new Error(`缺少当前版本产物：${absent.map(file => path.basename(file)).join("、")}。请在对应系统重新构建。`);

  const yaml = fs.readFileSync(path.join(artifactsDir, metadataName), "utf8");
  if (readUpdateYamlVersion(yaml) !== version)
    throw new Error(`${metadataName} 版本与 package.json 不一致，请重新构建。`);
  return required;
}

export async function writeSignedWindowsManifest({
  installerPath,
  arch,
  directory,
  version,
  releaseDate,
  releaseNotes,
  signer,
}) {
  const hash = createHash("sha512");
  for await (const chunk of fs.createReadStream(installerPath)) hash.update(chunk);
  const metadata = createWindowsUpdateMetadata({
    arch,
    filename: path.basename(installerPath),
    releaseDate,
    releaseNotes,
    sha512: hash.digest("base64"),
    size: fs.statSync(installerPath).size,
    version,
  });
  const filename = getWindowsUpdateManifestFilename(arch);
  const fullPath = path.join(directory, filename);
  fs.writeFileSync(fullPath, signUpdateMetadata(metadata, signer.privateKey, { keyId: signer.keyId }), "utf8");
  return { filename, fullPath };
}
