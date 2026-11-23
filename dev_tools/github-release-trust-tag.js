import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import { validateGitHubRepository } from "../shared/github-release.js";
import { getUpdateSigningTrust } from "../shared/update-signing.js";

function tagName(repository) {
  // Fork 可能带走上游的 Git 标签。公钥登记只约束自己的仓库。
  const name = validateGitHubRepository(repository).toLowerCase();
  return `biu-win-update-key-${createHash("sha256").update(name).digest("hex").slice(0, 32)}`;
}

function gitApi(repository, endpoint, fields = []) {
  const args = ["api", "--hostname", "github.com", `repos/${repository}/git/${endpoint}`];
  for (const field of fields) args.push("-f", field);
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

export function getRegisteredWindowsKey(repository, api = gitApi) {
  const tag = tagName(repository);
  const refs = api(repository, `matching-refs/tags/${tag}`);
  const ref = refs.find(ref => ref.ref === `refs/tags/${tag}`);
  if (!ref) return null;
  if (ref.object.type !== "tag") throw new Error("仓库中的 Windows 公钥标签格式无效，请检查该标签的记录。");
  const object = api(repository, `tags/${ref.object.sha}`);
  if (object.tag !== tag) throw new Error("仓库中的 Windows 公钥标签名称不匹配。");
  return getUpdateSigningTrust(object.message.trim()).publicKeyBase64;
}

export function registerWindowsKey(repository, commit, publicKeyBase64, api = gitApi) {
  getUpdateSigningTrust(publicKeyBase64);
  const tag = tagName(repository);
  let registered = getRegisteredWindowsKey(repository, api);
  if (!registered) {
    const object = api(repository, "tags", [
      `tag=${tag}`,
      `message=${publicKeyBase64}`,
      `object=${commit}`,
      "type=commit",
    ]);
    try {
      // GitHub 只能创建一次这个引用。两台电脑同时首发时，只会有一个公钥成功登记。
      api(repository, "refs", [`ref=refs/tags/${tag}`, `sha=${object.sha}`]);
      return;
    } catch (error) {
      if (!/reference already exists/i.test(error.stderr ?? error.message)) throw error;
      registered = getRegisteredWindowsKey(repository, api);
      if (!registered) throw error;
    }
  }
  if (registered !== publicKeyBase64) {
    throw new Error("本机密钥与此仓库已登记的 Windows 更新公钥不同，请从备份恢复原签名私钥。");
  }
}
