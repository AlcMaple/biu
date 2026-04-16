import { desktopCapturer, ipcMain, systemPreferences } from "electron";
import log from "electron-log";
import { Shazam } from "node-shazam";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getFfmpegPath } from "../utils";
import { channel } from "./channel";

/** WebM → WAV (16 kHz mono PCM) 转换，供 shazamio-core WASM 解码 */
function convertToWav(inputPath: string, outputPath: string): Promise<void> {
  // 内置 ffmpeg 是精简构建（不含 wav/pcm 编解码器），听歌识曲需要完整版
  const ffmpegBin = getFfmpegPath(true);
  if (!ffmpegBin) {
    return Promise.reject(new Error("未找到 ffmpeg，请安装完整版 ffmpeg 并加入系统 PATH，或在设置中配置路径"));
  }
  return new Promise((resolve, reject) => {
    // 直接调用 ffmpeg 可执行文件，绕过 fluent-ffmpeg 的 capability 检查
    // 避免 Windows 上 "Output format wav is not available" 误报
    execFile(
      ffmpegBin,
      ["-y", "-i", inputPath, "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le", "-f", "wav", outputPath],
      (error, _stdout, stderr) => {
        if (error) {
          log.error("[shazam] ffmpeg convert error:", stderr);
          reject(error);
        } else {
          resolve();
        }
      },
    );
  });
}

/** 单例 Shazam 实例（复用内部 WASM 模块，避免重复初始化） */
const shazam = new Shazam();

export function registerShazamHandlers() {
  /**
   * 识别音频：接收渲染进程录制的 ArrayBuffer，写入临时文件后调用 node-shazam 识别。
   * node-shazam v1.2+ 内部使用 shazamio-core (WASM) 生成音频指纹，无需 Python 或外部 ffmpeg。
   */
  ipcMain.handle(channel.shazam.recognize, async (_, audioBuffer: ArrayBuffer) => {
    const ts = Date.now();
    const webmFile = path.join(os.tmpdir(), `biu-shazam-${ts}.webm`);
    const wavFile = path.join(os.tmpdir(), `biu-shazam-${ts}.wav`);

    try {
      await fsp.writeFile(webmFile, Buffer.from(audioBuffer));

      // shazamio-core WASM 不支持 WebM/Opus，先用 ffmpeg 转为 WAV PCM
      await convertToWav(webmFile, wavFile);

      log.info("[shazam] recognising:", wavFile);

      const result = await shazam.recognise(wavFile, "zh-CN");

      if (!result) {
        return { error: "未能识别到歌曲，请确保音乐声音足够大后重试" };
      }

      // node-shazam 返回的是 ShazamRoot 对象，结构与 shazamio 一致，前端可直接消费
      return result;
    } catch (err) {
      log.error("[shazam] recognise error:", err);
      return { error: String(err) };
    } finally {
      fsp.unlink(webmFile).catch(() => {});
      fsp.unlink(wavFile).catch(() => {});
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

  /** macOS 首次使用前向系统申请麦克风权限，非 macOS 平台直接返回 true */
  ipcMain.handle(channel.shazam.requestMicPermission, async () => {
    if (process.platform !== "darwin") return true;
    try {
      const granted = await systemPreferences.askForMediaAccess("microphone");
      return granted;
    } catch (err) {
      log.error("[shazam] requestMicPermission error:", err);
      return false;
    }
  });
}
