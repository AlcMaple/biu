import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router";

import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ScrollShadow,
  Spinner,
  useDisclosure,
} from "@heroui/react";
import { RiComputerLine, RiFingerprintLine, RiMicLine, RiMusicLine, RiSearchLine } from "@remixicon/react";
import clx from "classnames";
import { motion } from "framer-motion";

import {
  AFP_SAMPLE_RATE,
  encodeWav,
  generateAudioFP,
  lrcToLines,
  PcmRecorder,
  resample,
} from "@/common/utils/audio-match";
import IconButton from "@/components/icon-button";
import platform, { isElectron, log } from "@/platform";
import { usePlayList } from "@/store/play-list";
import { useSearchHistory } from "@/store/search-history";

type RecordState = "idle" | "listening" | "success" | "error";

interface MatchCandidate {
  key: string;
  neteaseId?: number;
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  source: "netease" | "shazam";
}

type LyricsState = { status: "loading" } | { status: "done"; lines: string[]; from: string } | { status: "empty" };

/** 总流程时长（秒） */
const TOTAL_DURATION = 15;

/**
 * 发起网易云匹配的时间点及所取片段长度（秒）。
 * 实测网易云匹配端点只接受 3 的倍数时长（5/7/8/10 秒一律无结果），超过 12 秒收益不大。
 */
const MATCH_PLAN: Record<number, number> = { 3: 3, 6: 6, 9: 9, 12: 12, 15: 12 };

/** 桌面端网易云未命中时，用 Shazam 兜底的时间点 */
const SHAZAM_FALLBACK_AT = 12;

const isWindows = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);
const isMac = typeof navigator !== "undefined" && /macintosh/i.test(navigator.userAgent);

const formatMediaError = (err: unknown, source: "mic" | "system") => {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);

  if (source === "mic" && !navigator.mediaDevices?.getUserMedia) {
    return "当前浏览器不支持录音，请使用 HTTPS 访问，并在 Safari / Chrome 中打开";
  }

  if (source === "mic" && name === "NotAllowedError") {
    if (/system/i.test(message)) {
      return isWindows
        ? "系统拒绝了麦克风权限。请打开「Windows 设置 → 隐私和安全性 → 麦克风」，确认已开启「麦克风访问」「让应用访问你的麦克风」以及最底部的「允许桌面应用访问你的麦克风」，然后重启应用重试"
        : "系统拒绝了麦克风权限，请在操作系统的隐私设置中为本应用开启麦克风后重试";
    }
    return isElectron
      ? "麦克风权限被拒绝，请允许访问后重试"
      : "麦克风权限被拒绝。iPhone 请到「设置 → Safari → 麦克风」或地址栏「aA → 网站设置」中允许后重试";
  }

  if (source === "mic" && name === "NotFoundError") {
    return "未检测到麦克风设备，请确认已连接麦克风或在系统声音设置中启用输入设备";
  }

  if (source === "mic" && name === "NotReadableError") {
    return "麦克风被其他应用占用或驱动异常，请关闭占用应用或重启设备后重试";
  }

  // 系统声音捕获需要屏幕录制权限（macOS）或桌面视频源
  if (source === "system") {
    if (name === "NotAllowedError") {
      return isMac
        ? "没有屏幕与系统录音权限。请在「系统设置 → 隐私与安全性 → 屏幕与系统录音」中点「+」添加本应用（开发环境下是名为 Electron 的应用）并打开开关，然后完全退出应用重开"
        : "无法捕获系统音频，请检查屏幕录制/音频权限设置后重试";
    }
    if (name === "NotReadableError") {
      return "无法启动系统音频捕获，可能被其他应用占用，请关闭后重试";
    }
  }

  return message || String(err);
};

/** 根据已过秒数返回阶段提示文案 */
const getPhaseText = (elapsed: number): string => {
  if (elapsed < 3) return "正在聆听…";
  if (elapsed < 9) return "正在匹配曲库…";
  return "继续聆听，扩大识别范围…";
};

/** 把网易云结果转成候选，去重并把伴奏 / 纯音乐版本排到后面 */
const toCandidates = (resp: NeteaseAudioMatchResponse): MatchCandidate[] => {
  const seen = new Set<number>();
  const list: MatchCandidate[] = [];
  for (const item of resp.data?.result ?? []) {
    const song = item.song;
    if (!song?.id || seen.has(song.id)) continue;
    seen.add(song.id);
    list.push({
      key: `netease-${song.id}`,
      neteaseId: song.id,
      title: song.name,
      artist: (song.artists ?? [])
        .map(a => a.name)
        .filter(Boolean)
        .join(" / "),
      album: song.album?.name,
      cover: song.album?.picUrl?.replace(/^http:/, "https:"),
      source: "netease",
    });
  }
  const isAccompaniment = (c: MatchCandidate) => /伴奏|instrumental|karaoke|off vocal/i.test(c.title);
  return [...list.filter(c => !isAccompaniment(c)), ...list.filter(isAccompaniment)];
};

const WaveBars = ({ level }: { level: number }) => (
  <div className="flex items-center justify-center gap-[3px]" style={{ height: 48 }}>
    {[0, 1, 2, 3, 4, 5, 6].map(i => (
      <motion.div
        key={i}
        className="bg-primary w-1.5 rounded-full"
        style={{ height: 32, originY: 0.5 }}
        animate={{ scaleY: [0.3, 0.5 + Math.min(1, level * 4), 0.3] }}
        transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.1, ease: "easeInOut" }}
      />
    ))}
  </div>
);

const ShazamModal = () => {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const navigate = useNavigate();
  const [state, setState] = useState<RecordState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [selected, setSelected] = useState(0);
  const [lyrics, setLyrics] = useState<LyricsState>({ status: "loading" });
  const [error, setError] = useState("");
  const [needScreenPermission, setNeedScreenPermission] = useState(false);
  const lastSourceRef = useRef<"mic" | "system">("mic");

  const isPlaying = usePlayList(s => s.isPlaying);
  const togglePlay = usePlayList(s => s.togglePlay);
  const wasPlayingRef = useRef(false);

  const recorderRef = useRef<PcmRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 每轮识别的编号：关闭/重开后，上一轮迟到的响应据此丢弃 */
  const sessionRef = useRef(0);
  const doneRef = useRef(false);
  /** 3 秒短片段的结果噪声下易误识别，先暂存，等更长片段确认 */
  const tentativeRef = useRef<MatchCandidate[] | null>(null);
  const failuresRef = useRef<{ service: number; total: number }>({ service: 0, total: 0 });
  const lyricsReqRef = useRef(0);
  const maxPeakRef = useRef(0);

  const restorePlayback = useCallback(() => {
    if (wasPlayingRef.current) {
      togglePlay();
      wasPlayingRef.current = false;
    }
  }, [togglePlay]);

  /** 停止采集、释放麦克风（不使本轮已发出的请求失效） */
  const stopCapture = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    recorderRef.current?.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const loadLyrics = useCallback(async (c: MatchCandidate) => {
    const req = ++lyricsReqRef.current;
    setLyrics({ status: "loading" });
    const finish = (s: LyricsState) => {
      if (req === lyricsReqRef.current) setLyrics(s);
    };
    try {
      if (c.neteaseId) {
        const res = await platform.getNeteaseLyrics({ id: c.neteaseId });
        const lines = lrcToLines(res?.lrc?.lyric ?? "");
        if (lines.length) return finish({ status: "done", lines, from: "网易云音乐" });
      }
    } catch {
      /* 继续尝试 LRCLIB */
    }
    try {
      const list = await platform.searchLrclibLyrics({
        q: `${c.title} ${c.artist}`.trim(),
      } as SearchSongByLrclibParams);
      const hit = (list ?? []).find(x => x.plainLyrics || x.syncedLyrics);
      const text = hit?.plainLyrics || hit?.syncedLyrics || "";
      const lines = lrcToLines(text);
      if (lines.length) return finish({ status: "done", lines, from: "LRCLIB" });
    } catch {
      /* ignore */
    }
    finish({ status: "empty" });
  }, []);

  const showResult = useCallback(
    (list: MatchCandidate[]) => {
      if (doneRef.current || !list.length) return;
      doneRef.current = true;
      stopCapture();
      setCandidates(list);
      setSelected(0);
      setState("success");
      restorePlayback();
      void loadLyrics(list[0]);
    },
    [stopCapture, restorePlayback, loadLyrics],
  );

  const finishWithoutMatch = useCallback(() => {
    if (doneRef.current) return;
    if (tentativeRef.current?.length) return showResult(tentativeRef.current);
    doneRef.current = true;
    stopCapture();
    const { service, total } = failuresRef.current;
    if (total > 0 && service === total) {
      setError("识曲服务暂时不可用，请检查网络后重试");
    } else if (maxPeakRef.current < 0.01) {
      setError("没有识别到歌曲。麦克风几乎没收到声音，请靠近音源或调大音量后重试");
    } else {
      setError("没有识别到歌曲。请靠近音源、减少环境噪声后重试（曲库中没有版权的歌曲也无法识别）");
    }
    setState("error");
    restorePlayback();
  }, [showResult, stopCapture, restorePlayback]);

  const matchNetease = useCallback(
    async (session: number, seconds: number, isLast: boolean) => {
      const recorder = recorderRef.current;
      if (!recorder) return;
      const raw = recorder.tail(seconds);
      failuresRef.current.total += 1;
      try {
        const pcm8k = await resample(raw, recorder.sampleRate, AFP_SAMPLE_RATE);
        const audioFP = await generateAudioFP(pcm8k);
        const resp = await platform.neteaseAudioMatch({ duration: seconds, audioFP });
        if (session !== sessionRef.current || doneRef.current) return;
        const list = toCandidates(resp);
        if (list.length) {
          const prev = tentativeRef.current;
          if (seconds > 3) {
            // 若与 3 秒结果有交集，优先展示双方都命中的那首
            const agreed = prev ? list.find(c => prev.some(p => p.key === c.key)) : undefined;
            showResult(agreed ? [agreed, ...list.filter(c => c !== agreed)] : list);
          } else {
            tentativeRef.current = list;
          }
        }
      } catch (err) {
        failuresRef.current.service += 1;
        log.warn("[shazam-modal] netease match failed", err);
      }
      if (isLast && session === sessionRef.current) finishWithoutMatch();
    },
    [showResult, finishWithoutMatch],
  );

  /** 桌面端兜底：网易云曲库没有的歌（如部分欧美 / 无版权歌曲）交给 Shazam */
  const matchShazam = useCallback(
    async (session: number) => {
      const recorder = recorderRef.current;
      if (!recorder || !isElectron) return;
      try {
        const pcm16k = await resample(recorder.tail(SHAZAM_FALLBACK_AT), recorder.sampleRate, 16000);
        const raw = await platform.recognizeSong(encodeWav(pcm16k, 16000));
        if (session !== sessionRef.current || doneRef.current) return;
        const track = raw?.track as
          | { key?: string; title?: string; subtitle?: string; images?: { coverart?: string } }
          | undefined;
        if (!track?.title) return;
        showResult([
          {
            key: `shazam-${track.key ?? track.title}`,
            title: track.title,
            artist: track.subtitle ?? "",
            cover: track.images?.coverart,
            source: "shazam",
          },
        ]);
      } catch {
        /* 兜底失败不影响主流程 */
      }
    },
    [showResult],
  );

  const startRecording = useCallback(
    async (source: "mic" | "system") => {
      const session = ++sessionRef.current;
      lastSourceRef.current = source;
      setNeedScreenPermission(false);
      doneRef.current = false;
      tentativeRef.current = null;
      failuresRef.current = { service: 0, total: 0 };
      maxPeakRef.current = 0;
      setCandidates([]);
      setError("");
      setLevel(0);
      setElapsed(0);
      setState("listening");

      // iOS 要求 AudioContext 在用户手势内同步创建
      let recorder: PcmRecorder;
      try {
        recorder = new PcmRecorder();
      } catch {
        setError("当前浏览器不支持音频采集，请更新浏览器后重试");
        setState("error");
        return;
      }

      wasPlayingRef.current = isPlaying;
      if (isPlaying) togglePlay();

      let stream: MediaStream;
      try {
        if (source === "mic") {
          if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
          await platform.requestMicPermission();
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            video: false,
          });
        } else {
          // 主进程 setDisplayMediaRequestHandler 会自动选主屏 + loopback 音频，不弹系统选择器
          // 不加分辨率约束：ScreenCaptureKit 对 1x1 之类的约束会直接报 "Could not start video source"
          stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
          stream.getVideoTracks().forEach(t => t.stop());
          if (stream.getAudioTracks().length === 0) {
            stream.getTracks().forEach(t => t.stop());
            throw new Error("未获取到系统音频轨道（macOS 需 13 及以上版本），请改用麦克风识别");
          }
        }
        if (session !== sessionRef.current) {
          stream.getTracks().forEach(t => t.stop());
          recorder.stop();
          return;
        }
        await recorder.start(stream);
      } catch (err) {
        recorder.stop();
        if (session !== sessionRef.current) return;
        log.warn("[shazam-modal] capture failed", source, err instanceof Error ? `${err.name}: ${err.message}` : err);
        setError(formatMediaError(err, source));
        setNeedScreenPermission(isMac && source === "system" && err instanceof Error && err.name === "NotAllowedError");
        setState("error");
        restorePlayback();
        return;
      }

      streamRef.current = stream;
      recorderRef.current = recorder;
      // 预热指纹组件，避免第一次匹配时才下载
      void import("@/common/utils/audio-match").then(m => m.loadAfp()).catch(() => {});

      let tick = 0;
      timerRef.current = setInterval(() => {
        if (session !== sessionRef.current || doneRef.current) return;
        tick += 1;
        setElapsed(tick);
        const peak = recorderRef.current?.peak ?? 0;
        maxPeakRef.current = Math.max(maxPeakRef.current, peak);
        setLevel(peak);

        const seconds = MATCH_PLAN[tick];
        if (seconds) void matchNetease(session, seconds, tick >= TOTAL_DURATION);
        if (tick === SHAZAM_FALLBACK_AT) void matchShazam(session);
        if (tick >= TOTAL_DURATION) {
          // 停止采集，但等待最后一次匹配返回
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }, 1000);
    },
    [isPlaying, togglePlay, restorePlayback, matchNetease, matchShazam],
  );

  const reset = useCallback(() => {
    sessionRef.current += 1;
    lyricsReqRef.current += 1;
    stopCapture();
    setState("idle");
    setCandidates([]);
    setError("");
  }, [stopCapture]);

  const handleCancel = () => {
    reset();
    restorePlayback();
  };

  const handleClose = () => {
    reset();
    restorePlayback();
    onClose();
  };

  const selectCandidate = (index: number) => {
    setSelected(index);
    void loadLyrics(candidates[index]);
  };

  const searchInApp = (c: MatchCandidate) => {
    const keyword = `${c.title} ${c.artist.split(" / ")[0] ?? ""}`.trim();
    useSearchHistory.getState().add(keyword);
    handleClose();
    navigate("/search");
  };

  const current = candidates[selected];

  return (
    <>
      <IconButton tooltip="听歌识曲" onPress={onOpen}>
        <RiFingerprintLine size={18} />
      </IconButton>

      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        size="md"
        placement="center"
        scrollBehavior="inside"
        isDismissable={state !== "listening"}
      >
        <ModalContent>
          <ModalHeader>听歌识曲</ModalHeader>
          <ModalBody className="pb-6">
            {state === "idle" && (
              <div className="flex flex-col items-center gap-5 py-4">
                <p className="text-foreground-400 text-center text-sm">
                  对准正在播放的音乐，最长聆听 {TOTAL_DURATION} 秒，通常 3~6 秒出结果
                </p>
                <div className="flex gap-3">
                  <Button color="primary" startContent={<RiMicLine size={18} />} onPress={() => startRecording("mic")}>
                    开始识别
                  </Button>
                  {isElectron && (
                    <Button
                      variant="bordered"
                      startContent={<RiComputerLine size={18} />}
                      onPress={() => startRecording("system")}
                    >
                      系统声音
                    </Button>
                  )}
                </div>
              </div>
            )}

            {state === "listening" && (
              <div className="flex flex-col items-center gap-4 py-4">
                <WaveBars level={level} />
                <p className="text-foreground-400 text-sm">
                  {getPhaseText(elapsed)}（{elapsed}s）
                </p>
                {elapsed >= 3 && level < 0.01 && <p className="text-warning text-xs">几乎没有收到声音，请靠近音源</p>}
                <Button size="sm" variant="flat" onPress={handleCancel}>
                  停止
                </Button>
              </div>
            )}

            {state === "success" && current && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  {current.cover ? (
                    <img
                      src={current.source === "netease" ? `${current.cover}?param=200y200` : current.cover}
                      alt={current.title}
                      referrerPolicy="no-referrer"
                      className="h-22 w-22 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="bg-content2 flex h-22 w-22 shrink-0 items-center justify-center rounded-lg">
                      <RiMusicLine size={32} className="text-foreground-400" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold">{current.title}</p>
                    <p className="text-foreground-500 truncate text-sm">{current.artist}</p>
                    {current.album && <p className="text-foreground-400 truncate text-xs">{current.album}</p>}
                  </div>
                </div>

                {candidates.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-foreground-400 self-center text-xs">其他可能：</span>
                    {candidates.slice(0, 5).map((c, i) => (
                      <button
                        type="button"
                        key={c.key}
                        onClick={() => selectCandidate(i)}
                        className={clx("max-w-full truncate rounded-full border px-2 py-0.5 text-xs", {
                          "border-primary text-primary": i === selected,
                          "border-default-200 text-foreground-500": i !== selected,
                        })}
                      >
                        {c.title} - {c.artist}
                      </button>
                    ))}
                  </div>
                )}

                <div className="bg-content2 rounded-lg p-3">
                  {lyrics.status === "loading" && (
                    <div className="flex justify-center py-6">
                      <Spinner size="sm" />
                    </div>
                  )}
                  {lyrics.status === "empty" && (
                    <p className="text-foreground-400 py-4 text-center text-sm">暂无歌词（可能是纯音乐）</p>
                  )}
                  {lyrics.status === "done" && (
                    <>
                      <ScrollShadow className="max-h-[40vh] space-y-1.5 text-center text-sm leading-relaxed">
                        {lyrics.lines.map((line, i) => (
                          <p key={i}>{line}</p>
                        ))}
                      </ScrollShadow>
                      <p className="text-foreground-400 mt-2 text-right text-[10px]">歌词来源：{lyrics.from}</p>
                    </>
                  )}
                </div>

                <div className="flex justify-center gap-2">
                  <Button size="sm" variant="flat" onPress={() => startRecording("mic")}>
                    再次识别
                  </Button>
                  <Button
                    size="sm"
                    color="primary"
                    startContent={<RiSearchLine size={14} />}
                    onPress={() => searchInApp(current)}
                  >
                    在 Biu 中搜索
                  </Button>
                </div>
              </div>
            )}

            {state === "error" && (
              <div className="flex flex-col items-center gap-4 py-4">
                <p className="text-danger text-center text-sm">{error}</p>
                <div className="flex gap-2">
                  {needScreenPermission && (
                    <Button
                      size="sm"
                      color="primary"
                      onPress={() =>
                        platform.openExternal(
                          "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
                        )
                      }
                    >
                      打开系统设置
                    </Button>
                  )}
                  <Button size="sm" variant="flat" onPress={() => startRecording(lastSourceRef.current)}>
                    重试
                  </Button>
                  {lastSourceRef.current === "system" && (
                    <Button size="sm" variant="flat" onPress={() => startRecording("mic")}>
                      改用麦克风
                    </Button>
                  )}
                </div>
              </div>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
};

export default ShazamModal;
