import moment from "moment";

import { log } from "@/platform";
import { getAudioWebStreamUrl } from "@/service/audio-web-url";
import { getPlayerPlayurl, type DashAudio } from "@/service/player-playurl";
import { useUser } from "@/store/user";

import { audioQualitySort } from "../constants/audio";
import { VideoFnval } from "../constants/video";
import { getUrlParams } from "./url";

function sortAudio(audio: DashAudio[]) {
  return audio.toSorted((a, b) => {
    if (a.bandwidth !== b.bandwidth) {
      return b.bandwidth - a.bandwidth;
    }

    const indexA = audioQualitySort.indexOf(a.id);
    const indexB = audioQualitySort.indexOf(b.id);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexB - indexA;
  });
}

/**
 * PCDN/MCDN 节点（如 xy…xy.mcdn.bilivideo.cn、*.szbdyd.com）对第三方播放器限速严重，
 * 常出现播放几秒后卡死或直接返回坏数据（MediaError code 4 Format error）。
 * B 站经常把这类节点放在 baseUrl，稳定的 upos 源在 backupUrl 里。
 */
const isPcdnUrl = (url: string) => {
  try {
    const { hostname } = new URL(url);
    return hostname.endsWith(".mcdn.bilivideo.cn") || hostname.endsWith(".szbdyd.com");
  } catch {
    return false;
  }
};

/** 从 baseUrl/backupUrl 收集去重后的候选地址，按“正规源优先、PCDN 兜底”排序 */
const collectStreamUrls = (baseUrl?: string, backupUrl?: string[]) => {
  const candidates = [...new Set([baseUrl, ...(backupUrl || [])].filter((url): url is string => Boolean(url)))];
  return [...candidates.filter(url => !isPcdnUrl(url)), ...candidates.filter(url => isPcdnUrl(url))];
};

function selectAudioByQuality(audioList: DashAudio[], quality: AudioQuality): DashAudio | undefined {
  if (!audioList.length) return undefined;

  const sortedList = sortAudio(audioList);

  switch (quality) {
    case "high":
      return sortedList[0];
    case "medium": {
      const midIndex = Math.floor((sortedList.length - 1) / 2);
      return sortedList[midIndex];
    }
    case "low":
      return sortedList[sortedList.length - 1];
    default:
      return sortedList[0];
  }
}

export async function getDashUrl(bvid: string, cid: string | number, audioQuality: AudioQuality = "auto") {
  try {
    const getUrlInfoRes = await getPlayerPlayurl({
      bvid,
      cid,
      fnval: VideoFnval.AllDash,
    });

    const bestVideoInfo = getUrlInfoRes?.data?.dash?.video?.[0];
    const videoResolution = `${bestVideoInfo?.width}x${bestVideoInfo?.height}`;
    const videoUrl = collectStreamUrls(bestVideoInfo?.baseUrl, bestVideoInfo?.backupUrl)[0];
    const flacAudio = getUrlInfoRes?.data?.dash?.flac?.audio;
    const dolbyAudio = getUrlInfoRes?.data?.dash?.dolby?.audio?.[0];

    if (audioQuality === "auto" || audioQuality === "lossless") {
      if (flacAudio) {
        const audioUrlCandidates = collectStreamUrls(flacAudio.baseUrl, flacAudio.backupUrl);
        return {
          isLossless: true,
          audioCodecs: flacAudio.codecs.toLowerCase(),
          audioBandwidth: flacAudio.bandwidth,
          audioUrl: audioUrlCandidates[0] || "",
          audioUrlCandidates,
          videoUrl,
          videoResolution,
        };
      }

      if (dolbyAudio) {
        const audioUrlCandidates = collectStreamUrls(dolbyAudio.baseUrl, dolbyAudio.backupUrl);
        return {
          isLossless: false,
          isDolby: true,
          audioCodecs: dolbyAudio.codecs.toLowerCase(),
          audioBandwidth: dolbyAudio.bandwidth,
          audioUrl: audioUrlCandidates[0] || "",
          audioUrlCandidates,
          videoUrl,
          videoResolution: `${bestVideoInfo?.width}x${bestVideoInfo?.height}`,
        };
      }
    }

    const audioList = getUrlInfoRes?.data?.dash?.audio || [];
    const selectedAudio = selectAudioByQuality(audioList, audioQuality);
    const audioUrlCandidates = collectStreamUrls(selectedAudio?.baseUrl, selectedAudio?.backupUrl);
    return {
      isLossless: false,
      audioCodecs: selectedAudio?.codecs?.toLowerCase() || "",
      audioBandwidth: selectedAudio?.bandwidth,
      audioUrl: audioUrlCandidates[0] || "",
      audioUrlCandidates,
      videoUrl,
      videoResolution,
    };
  } catch (error) {
    log.error("[Get video play url error]", error);
    return {
      isLossless: false,
    };
  }
}

/**
 * 登录情况下获取音乐播放链接
 */
export const getAudioUrl = async (sid: number | string) => {
  const res = await getAudioWebStreamUrl({
    songid: sid,
    quality: useUser.getState().user?.vipStatus ? 3 : 2,
    privilege: 2,
    mid: useUser.getState().user?.mid || 0,
    platform: "web",
  });

  const isFlac = res?.data?.type === 3;

  return {
    audioUrl: res?.data?.cdns?.[0],
    audioUrlCandidates: res?.data?.cdns || [],
    audioCodecs: isFlac ? "flac" : "",
    isLossless: isFlac,
  };
};

/** URL是否有效 */
export const isUrlValid = (url?: string): url is string => {
  return Boolean(url) && moment().isBefore(moment.unix(Number(getUrlParams(url as string).deadline)));
};
