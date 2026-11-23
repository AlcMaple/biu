import { generateKeyPairSync } from "node:crypto";
import { expect, it, vi } from "vitest";

import * as windowsTrust from "../dev_tools/github-release-trust-tag.js";

const repository = "someone/biu";
const commit = "a".repeat(40);
const firstKey = makeKey();
const secondKey = makeKey();

function makeKey() {
  return generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64");
}

function makeGitApi(onCreateRef = () => {}) {
  const refs = new Map<string, string>();
  const tags = new Map<string, { tag: string; message: string }>();
  let created = 0;
  return vi.fn((_repository: string, endpoint: string, fields: string[] = []) => {
    function field(name: string) {
      const entry = fields.find(item => item.startsWith(`${name}=`));
      if (!entry) throw new Error(`missing ${name}`);
      return entry.slice(name.length + 1);
    }
    if (endpoint.startsWith("matching-refs/")) {
      return [...refs.entries()].map(([ref, sha]) => ({ ref, object: { type: "tag", sha } }));
    }
    if (endpoint.startsWith("tags/")) return tags.get(endpoint.slice(5));
    if (endpoint === "tags") {
      expect(field("object")).toBe(commit);
      expect(field("type")).toBe("commit");
      const sha = (++created).toString(16).padStart(40, "0");
      tags.set(sha, { tag: field("tag"), message: field("message") });
      return { sha };
    }
    if (endpoint === "refs") {
      onCreateRef();
      if (refs.has(field("ref"))) throw new Error("gh: Reference already exists (HTTP 422)");
      refs.set(field("ref"), field("sha"));
      return {};
    }
    throw new Error(`unexpected endpoint ${endpoint}`);
  });
}

it("reads and reuses the fork's public key, even when copied upstream tags exist", () => {
  const api = makeGitApi();
  windowsTrust.registerWindowsKey("upstream/biu", commit, secondKey, api);
  expect(windowsTrust.getRegisteredWindowsKey(repository, api)).toBeNull();
  windowsTrust.registerWindowsKey(repository, commit, firstKey, api);
  windowsTrust.registerWindowsKey(repository.toUpperCase(), commit, firstKey, api);
  expect(windowsTrust.getRegisteredWindowsKey(repository, api)).toBe(firstKey);
  expect(api.mock.calls.filter(([, endpoint]) => endpoint === "refs")).toHaveLength(2);
});

it.each([true, false])("resolves simultaneous first registrations (same key: %s)", sameKey => {
  let pending = true;
  const api = makeGitApi(() => {
    if (!pending) return;
    pending = false;
    windowsTrust.registerWindowsKey(repository, commit, firstKey, api);
  });
  const register = () => windowsTrust.registerWindowsKey(repository, commit, sameKey ? firstKey : secondKey, api);
  if (sameKey) expect(register).not.toThrow();
  else expect(register).toThrow("从备份恢复");
  expect(windowsTrust.getRegisteredWindowsKey(repository, api)).toBe(firstKey);
});

it("preserves API errors without repeating the failed write", () => {
  const api = makeGitApi(() => {
    throw new Error("gh: Resource not accessible (HTTP 403)");
  });
  expect(() => windowsTrust.registerWindowsKey(repository, commit, firstKey, api)).toThrow("HTTP 403");
  expect(api.mock.calls).toHaveLength(3);
});
