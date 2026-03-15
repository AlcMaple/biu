import { ipcMain } from "electron";

import { getLyricsByLrclib, type SeachSongByLrclibParams } from "./api/lrclib-lyric";
import {
  getLyricsByNetease,
  getSongByNetease,
  type GetLyricsByNeteaseParams,
  type SearchSongByNeteaseParams,
} from "./api/netease-lyric";
import {
  checkWhisperXDeps,
  installWhisperXDeps,
  syncLyricsWithWhisperX,
  type WhisperXProgressEvent,
  type WhisperXSyncParams,
} from "./api/whisperx-sync";
import { channel } from "./channel";

export function registerLyricsHandlers() {
  ipcMain.handle(channel.lyrics.searchNeteaseSongs, async (_, params: SearchSongByNeteaseParams) => {
    return getSongByNetease(params);
  });

  ipcMain.handle(channel.lyrics.getNeteaseLyrics, async (_, params: GetLyricsByNeteaseParams) => {
    return getLyricsByNetease(params);
  });

  ipcMain.handle(channel.lyrics.searchLrclib, async (_, params: SeachSongByLrclibParams) => {
    return getLyricsByLrclib(params);
  });

  ipcMain.handle(channel.lyrics.checkWhisperXDeps, async () => checkWhisperXDeps());
  ipcMain.handle(channel.lyrics.installWhisperXDeps, async () => installWhisperXDeps());

  ipcMain.on(channel.lyrics.syncWithWhisperXStart, (event, params: WhisperXSyncParams) => {
    const onProgress = (progress: WhisperXProgressEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(channel.lyrics.syncWithWhisperXProgress, progress);
      }
    };
    syncLyricsWithWhisperX(params, onProgress)
      .then(syncedLrc => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(channel.lyrics.syncWithWhisperXDone, { syncedLrc, originalLrc: params.lrc, error: null });
        }
      })
      .catch(err => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(channel.lyrics.syncWithWhisperXDone, {
            syncedLrc: null,
            originalLrc: params.lrc,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
  });
}
