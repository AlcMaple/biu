import type { AddressInfo } from "node:net";

import { createServer } from "node:http";
import { describe, expect, test, vi } from "vitest";

import { usePlayList } from "@/store/play-list";

const fixture = vi.hoisted(() => ({ origin: "" }));
vi.mock("@/common/utils/audio", () => ({
  getAudioUrl: vi.fn(async () => {
    const response = await fetch(`${fixture.origin}/resolve`);
    const data = (await response.json()) as { audioUrl: string };
    return { ...data, isLossless: false };
  }),
  getDashUrl: vi.fn(),
  getMVUrl: vi.fn(),
  isUrlValid: (url: unknown) => typeof url === "string" && url.length > 0,
  isResourceGoneCode: () => false,
}));

vi.mock("@heroui/react", async () => {
  const actual = await vi.importActual<typeof import("@heroui/react")>("@heroui/react");
  return { ...actual, addToast: vi.fn() };
});

describe("匿名播放错误的真实loopback请求记录", () => {
  test.each([429, 503, 423, 403, 412, 404, 206])(
    "HTTP %s 后记录实际取址与媒体请求",
    async status => {
      const requests: { path: string; range: string | undefined; status: number }[] = [];
      const server = createServer((request, response) => {
        if (request.url === "/resolve") {
          requests.push({ path: "/resolve", range: request.headers.range, status: 200 });
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ audioUrl: `${fixture.origin}/media` }));
        } else if (request.url === "/media") {
          requests.push({ path: "/media", range: request.headers.range, status });
          response.writeHead(status, { "Content-Type": "audio/mp4" });
          response.end("fixture");
        } else {
          response.writeHead(404);
          response.end();
        }
      });
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      fixture.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const store = usePlayList.getState();
      try {
        store.clear();
        await store.init();
        const audio = store.getAudio();
        usePlayList.setState({
          list: [
            {
              id: `status-${status}`,
              type: "audio",
              sid: status,
              title: "合成匿名歌曲",
              audioUrl: `${fixture.origin}/media`,
            },
          ],
          playId: `status-${status}`,
        });
        audio.src = `${fixture.origin}/media`;
        const initial = await fetch(`${fixture.origin}/media`);
        await initial.arrayBuffer();
        Object.defineProperty(audio, "error", {
          configurable: true,
          value: { code: 2, message: "synthetic media error" },
        });
        const before = requests.length;
        audio.onerror?.(new Event("error"));
        await new Promise(resolve => setTimeout(resolve, 2300));
        const after = requests.slice(before);
        const resolveCount = after.filter(entry => entry.path === "/resolve").length;
        const probeCount = after.filter(entry => entry.path === "/media").length;
        console.log(
          JSON.stringify({
            scenario: "anonymous-media-error",
            status,
            initialRequests: before,
            requestsAfterError: after,
            resolveCount,
            probeCount,
            scope: "actual store + real loopback HTTP; synthetic Audio event and resolver boundary",
          }),
        );
        if ([429, 503, 423].includes(status)) {
          expect(resolveCount).toBe(0);
        } else {
          expect(resolveCount).toBe(1);
        }
        expect(probeCount).toBe(1);
        expect(initial.status).toBe(status);
      } finally {
        store.clear();
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
      }
    },
    10000,
  );
});
