import { desktopCapturer, ipcMain } from "electron";
import log from "electron-log";
import { Shazam } from "node-shazam";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { channel } from "./channel";

/** 单例 Shazam 实例（复用内部 WASM 模块，避免重复初始化） */
const shazam = new Shazam();

export function registerShazamHandlers() {
  /**
   * 识别音频：接收渲染进程录制的 ArrayBuffer，写入临时文件后调用 node-shazam 识别。
   * node-shazam v1.2+ 内部使用 shazamio-core (WASM) 生成音频指纹，无需 Python 或外部 ffmpeg。
   */
  ipcMain.handle(channel.shazam.recognize, async (_, audioBuffer: ArrayBuffer) => {
    const tempFile = path.join(os.tmpdir(), `biu-shazam-${Date.now()}.webm`);

    try {
      await fsp.writeFile(tempFile, Buffer.from(audioBuffer));

      log.info("[shazam] recognising:", tempFile);

      const result = await shazam.recognise(tempFile, "zh-CN");

      if (!result) {
        return { error: "未能识别到歌曲，请确保音乐声音足够大后重试" };
      }

      // node-shazam 返回的是 ShazamRoot 对象，结构与 shazamio 一致，前端可直接消费
      return result;
    } catch (err) {
      log.error("[shazam] recognise error:", err);
      return { error: String(err) };
    } finally {
      fsp.unlink(tempFile).catch(() => {});
    }
  });

  ipcMain.handle(channel.shazam.getDesktopSources, async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen"] });
      return sources.map(s => ({ id: s.id, name: s.name }));
    } catch (err) {
      log.error("[shazam] desktopCapturer error:", err);
      return [];
    }
  });
}
