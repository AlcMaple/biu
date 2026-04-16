import { useCallback, useRef, useState } from "react";

import { addToast, Button, Image, Modal, ModalBody, ModalContent, ModalHeader, useDisclosure } from "@heroui/react";
import { RiComputerLine, RiExternalLinkLine, RiFingerprintLine, RiMicLine, RiMusicLine } from "@remixicon/react";
import { motion } from "framer-motion";

import IconButton from "@/components/icon-button";
import { usePlayList } from "@/store/play-list";

type RecordState = "idle" | "listening" | "success" | "error";

interface ShazamResult {
  title: string;
  artist: string;
  cover?: string;
  url?: string;
}

/** 总流程时长（秒） */
const TOTAL_DURATION = 15;

/** 各阶段发起识别的时间点（秒） */
const RECOGNIZE_AT = [5, 8, 13] as const;

/** 弹出非阻断式提示的时间点（秒） */
const TOAST_AT = 10;

const isWindows = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);
const isMac = typeof navigator !== "undefined" && /macintosh/i.test(navigator.userAgent);

const formatMediaError = (err: unknown, source: "mic" | "system") => {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);

  if (source === "mic" && name === "NotAllowedError") {
    if (/system/i.test(message)) {
      return isWindows
        ? "系统拒绝了麦克风权限。请打开「Windows 设置 → 隐私和安全性 → 麦克风」，确认已开启「麦克风访问」「让应用访问你的麦克风」以及最底部的「允许桌面应用访问你的麦克风」，然后重启应用重试"
        : "系统拒绝了麦克风权限，请在操作系统的隐私设置中为本应用开启麦克风后重试";
    }
    return "麦克风权限被拒绝，请允许访问后重试";
  }

  if (source === "mic" && name === "NotFoundError") {
    return "未检测到麦克风设备，请确认已连接麦克风或在系统声音设置中启用输入设备";
  }

  if (source === "mic" && name === "NotReadableError") {
    return "麦克风被其他应用占用或驱动异常，请关闭占用应用或重启设备后重试";
  }

  // 系统声音捕获需要屏幕录制权限（macOS）或桌面视频源
  if (source === "system") {
    if (name === "NotAllowedError" || /Could not start video source/i.test(message)) {
      return isMac
        ? "系统拒绝了屏幕录制权限。请前往「系统设置 → 隐私与安全性 → 屏幕录制」，为本应用开启权限后重启应用重试"
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
  if (elapsed < 5) return `录音中（${elapsed}s）`;
  if (elapsed < 8) return `搜索中（${elapsed}s）`;
  if (elapsed < 13) return `正在努力匹配（${elapsed}s）`;
  return `扩大识别范围（${elapsed}s）`;
};

const WaveBars = () => (
  <div className="flex items-center justify-center gap-[3px]" style={{ height: 48 }}>
    {[0, 1, 2, 3, 4, 5, 6].map(i => (
      <motion.div
        key={i}
        className="bg-primary w-1.5 rounded-full"
        style={{ height: 32, originY: 0.5 }}
        animate={{ scaleY: [0.4, 1.4, 0.4] }}
        transition={{
          duration: 0.8,
          repeat: Infinity,
          delay: i * 0.1,
          ease: "easeInOut",
        }}
      />
    ))}
  </div>
);

const ShazamModal = () => {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [state, setState] = useState<RecordState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<ShazamResult | null>(null);
  const [error, setError] = useState("");

  const isPlaying = usePlayList(s => s.isPlaying);
  const togglePlay = usePlayList(s => s.togglePlay);
  const wasPlayingRef = useRef(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);
  const recognizedRef = useRef(false);
  const toastShownRef = useRef(false);

  /** 恢复播放（仅在之前暂停过的情况下），调用后清除标记防止重复触发 */
  const restorePlayback = useCallback(() => {
    if (wasPlayingRef.current) {
      togglePlay();
      wasPlayingRef.current = false;
    }
  }, [togglePlay]);

  /** 停止录音、清理计时器和媒体流 */
  const stopEverything = useCallback(() => {
    cancelledRef.current = true;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  /** 收集当前已录制的 chunks 发送识别请求，识别成功立即结束流程 */
  const sendRecognition = useCallback(async () => {
    if (cancelledRef.current || recognizedRef.current) return;

    const mimeType = mediaRecorderRef.current?.mimeType || "audio/webm";
    const blob = new Blob([...chunksRef.current], { type: mimeType });
    if (blob.size === 0) return;

    const arrayBuffer = await blob.arrayBuffer();

    try {
      const raw = await window.electron.recognizeSong(arrayBuffer);

      if (cancelledRef.current || recognizedRef.current) return;
      if (raw.error || !raw.track) return;

      // 识别成功
      recognizedRef.current = true;
      stopEverything();

      const track = raw.track as {
        title?: string;
        subtitle?: string;
        images?: { coverart?: string };
        url?: string;
      };

      setResult({
        title: track.title ?? "",
        artist: track.subtitle ?? "",
        cover: track.images?.coverart,
        url: track.url,
      });
      setState("success");
      restorePlayback();
    } catch {
      // 网络等异常静默忽略，等待下一次识别尝试
    }
  }, [stopEverything, restorePlayback]);

  const startRecording = useCallback(
    async (source: "mic" | "system") => {
      chunksRef.current = [];
      cancelledRef.current = false;
      recognizedRef.current = false;
      toastShownRef.current = false;
      setState("listening");
      setElapsed(0);

      // 识别前暂停播放
      wasPlayingRef.current = isPlaying;
      if (isPlaying) togglePlay();

      let stream: MediaStream;
      try {
        if (source === "mic") {
          await window.electron.requestMicPermission();
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
            video: false,
          });
        } else {
          const sources = await window.electron.getDesktopSources();
          if (!sources.length) throw new Error("无法获取系统音频源");

          const sourceId = sources[0].id;
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              // @ts-expect-error Electron-specific constraint
              mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId },
            },
            video: {
              // @ts-expect-error Electron-specific constraint
              mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId, maxWidth: 1, maxHeight: 1 },
            },
          });
          stream.getVideoTracks().forEach(t => {
            try {
              t.stop();
            } catch {
              /* ignore */
            }
          });
          if (stream.getAudioTracks().length === 0) {
            stream.getTracks().forEach(t => {
              try {
                t.stop();
              } catch {
                /* ignore */
              }
            });
            throw new Error(
              "未获取到系统音频轨道。macOS 不支持直接捕获系统音频，请改用麦克风，或安装虚拟音频设备（如 BlackHole）后将系统输出路由到麦克风输入",
            );
          }
        }
      } catch (err) {
        setError(formatMediaError(err, source));
        setState("error");
        restorePlayback();
        return;
      }

      streamRef.current = stream;

      const recorderOptions: MediaRecorderOptions = {};
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        recorderOptions.mimeType = "audio/webm;codecs=opus";
      }
      recorderOptions.audioBitsPerSecond = 128000;
      const recorder = new MediaRecorder(stream, recorderOptions);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      };

      // 每秒产出一个 chunk，以便分阶段截取不同长度的音频
      recorder.start(1000);

      let currentElapsed = 0;
      const recognizeAtSet = new Set<number>(RECOGNIZE_AT);

      timerRef.current = setInterval(() => {
        if (cancelledRef.current || recognizedRef.current) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          return;
        }

        currentElapsed += 1;
        setElapsed(currentElapsed);

        // 在指定时间点发起识别请求（异步，不阻塞录音）
        if (recognizeAtSet.has(currentElapsed)) {
          sendRecognition();
        }

        // 10 秒时弹出非阻断式提示
        if (currentElapsed === TOAST_AT && !toastShownRef.current && !recognizedRef.current) {
          toastShownRef.current = true;
          addToast({ title: "未识别到音乐，请靠近音源再试", color: "warning" });
        }

        // 15 秒到达，结束整个流程
        if (currentElapsed >= TOTAL_DURATION && !recognizedRef.current) {
          stopEverything();
          setError("未能识别到歌曲，请确保音乐声音足够大后重试（建议在安静环境下使用麦克风）");
          setState("error");
          restorePlayback();
        }
      }, 1000);
    },
    [isPlaying, togglePlay, sendRecognition, stopEverything, restorePlayback],
  );

  /** 停止按钮：取消整个流程，不触发识别 */
  const handleCancel = useCallback(() => {
    stopEverything();
    setState("idle");
    setResult(null);
    setError("");
    restorePlayback();
  }, [stopEverything, restorePlayback]);

  const handleClose = () => {
    stopEverything();
    setState("idle");
    setResult(null);
    setError("");
    restorePlayback();
    onClose();
  };

  const handleRetry = () => {
    setState("idle");
    setResult(null);
    setError("");
  };

  return (
    <>
      <IconButton tooltip="听歌识曲" onPress={onOpen}>
        <RiFingerprintLine size={18} />
      </IconButton>

      <Modal isOpen={isOpen} onClose={handleClose} size="sm">
        <ModalContent>
          <ModalHeader>听歌识曲</ModalHeader>
          <ModalBody className="pb-6">
            {state === "idle" && (
              <div className="flex flex-col items-center gap-5 py-4">
                <p className="text-foreground-400 text-sm">选择声音来源，最长录制 {TOTAL_DURATION} 秒自动识别</p>
                <div className="flex gap-3">
                  <Button
                    variant="bordered"
                    startContent={<RiMicLine size={18} />}
                    onPress={() => startRecording("mic")}
                  >
                    麦克风
                  </Button>
                  <Button
                    variant="bordered"
                    startContent={<RiComputerLine size={18} />}
                    onPress={() => startRecording("system")}
                  >
                    系统声音
                  </Button>
                </div>
              </div>
            )}

            {state === "listening" && (
              <div className="flex flex-col items-center gap-4 py-4">
                <WaveBars />
                <p className="text-foreground-400 text-sm">{getPhaseText(elapsed)}</p>
                <Button size="sm" variant="flat" onPress={handleCancel}>
                  停止
                </Button>
              </div>
            )}

            {state === "success" && result && (
              <div className="flex flex-col items-center gap-4 py-2">
                {result.cover ? (
                  <Image src={result.cover} width={120} height={120} className="rounded-lg" />
                ) : (
                  <div className="bg-content2 flex h-24 w-24 items-center justify-center rounded-lg">
                    <RiMusicLine size={32} className="text-foreground-400" />
                  </div>
                )}
                <div className="text-center">
                  <p className="text-lg font-semibold">{result.title}</p>
                  <p className="text-foreground-400 text-sm">{result.artist}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="flat" onPress={handleRetry}>
                    再次识别
                  </Button>
                  {result.url && (
                    <Button
                      size="sm"
                      color="primary"
                      endContent={<RiExternalLinkLine size={14} />}
                      onPress={() => window.electron.openExternal(result.url!)}
                    >
                      查看详情
                    </Button>
                  )}
                </div>
              </div>
            )}

            {state === "error" && (
              <div className="flex flex-col items-center gap-4 py-4">
                <p className="text-danger text-center text-sm">{error}</p>
                <Button size="sm" variant="flat" onPress={handleRetry}>
                  重试
                </Button>
              </div>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
};

export default ShazamModal;
