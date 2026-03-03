import { useCallback, useRef, useState } from "react";

import { Button, Image, Modal, ModalBody, ModalContent, ModalHeader, Spinner, useDisclosure } from "@heroui/react";
import { RiComputerLine, RiExternalLinkLine, RiFingerprintLine, RiMicLine, RiMusicLine } from "@remixicon/react";
import { motion } from "framer-motion";

import IconButton from "@/components/icon-button";

type RecordState = "idle" | "checking" | "installing" | "recording" | "processing" | "success" | "error";

interface ShazamResult {
  title: string;
  artist: string;
  cover?: string;
  url?: string;
}

const RECORD_DURATION = 8;

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
  const [countdown, setCountdown] = useState(RECORD_DURATION);
  const [result, setResult] = useState<ShazamResult | null>(null);
  const [error, setError] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingSourceRef = useRef<"mic" | "system" | null>(null);

  const cleanup = useCallback((stream?: MediaStream) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    stream?.getTracks().forEach(t => t.stop());
  }, []);

  const startRecording = useCallback(
    async (source: "mic" | "system") => {
      chunksRef.current = [];
      setState("checking");

      const check = await window.electron.checkShazamDeps();
      if (!check.ok) {
        if (check.missingDep === "shazamio") {
          // Python found but shazamio missing — auto-install it
          pendingSourceRef.current = source;
          setState("installing");
          const install = await window.electron.installShazamio();
          if (!install.ok) {
            setError(install.error ?? "安装 ShazamIO 失败");
            setState("error");
            return;
          }
          // Re-verify after install
          const recheck = await window.electron.checkShazamDeps();
          if (!recheck.ok) {
            setError(recheck.error ?? "依赖检查失败");
            setState("error");
            return;
          }
        } else {
          setError(check.error ?? "依赖检查失败");
          setState("error");
          return;
        }
      }

      setState("recording");
      setCountdown(RECORD_DURATION);

      let stream: MediaStream;
      try {
        if (source === "mic") {
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
          stream.getVideoTracks().forEach(t => { try { t.stop(); } catch {} });
          if (stream.getAudioTracks().length === 0) {
            stream.getTracks().forEach(t => { try { t.stop(); } catch {} });
            throw new Error("未获取到系统音频轨道。macOS 不支持直接捕获系统音频，请改用麦克风，或安装虚拟音频设备（如 BlackHole）后将系统输出路由到麦克风输入");
          }
        }
      } catch (err) {
        setError(String(err));
        setState("error");
        return;
      }

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

      recorder.onstop = async () => {
        cleanup(stream);
        setState("processing");

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        if (blob.size === 0) {
          setError("未录制到音频数据，请检查麦克风权限后重试");
          setState("error");
          return;
        }
        const arrayBuffer = await blob.arrayBuffer();

        try {
          const raw = await window.electron.recognizeSong(arrayBuffer);

          if (raw.error) {
            setError(raw.error);
            setState("error");
            return;
          }

          if (!raw.track) {
            setError("未能识别到歌曲，请确保音乐声音足够大后重试（建议在安静环境下使用麦克风，或确保 ffmpeg 已安装）");
            setState("error");
            return;
          }

          setResult({
            title: raw.track.title,
            artist: raw.track.subtitle,
            cover: raw.track.images?.coverart,
            url: raw.track.url,
          });
          setState("success");
        } catch (err) {
          setError(String(err));
          setState("error");
        }
      };

      recorder.start();

      let remaining = RECORD_DURATION;
      timerRef.current = setInterval(() => {
        remaining -= 1;
        setCountdown(remaining);
        if (remaining <= 0) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          if (mediaRecorderRef.current?.state === "recording") {
            mediaRecorderRef.current.stop();
          }
        }
      }, 1000);
    },
    [cleanup],
  );

  const handleClose = () => {
    cleanup();
    pendingSourceRef.current = null;
    setState("idle");
    setResult(null);
    setError("");
    onClose();
  };

  const handleRetry = () => {
    pendingSourceRef.current = null;
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
                <p className="text-foreground-400 text-sm">选择声音来源，录制约 {RECORD_DURATION} 秒后自动识别</p>
                <div className="flex gap-3">
                  <Button variant="bordered" startContent={<RiMicLine size={18} />} onPress={() => startRecording("mic")}>
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

            {state === "checking" && (
              <div className="flex flex-col items-center gap-4 py-6">
                <Spinner size="md" />
                <p className="text-foreground-400 text-sm">检查依赖...</p>
              </div>
            )}

            {state === "installing" && (
              <div className="flex flex-col items-center gap-4 py-6">
                <Spinner size="md" />
                <p className="text-foreground-400 text-sm">正在安装 ShazamIO，请稍候...</p>
              </div>
            )}

            {state === "recording" && (
              <div className="flex flex-col items-center gap-4 py-4">
                <WaveBars />
                <p className="text-foreground-400 text-sm">正在听... {countdown}s</p>
                <Button
                  size="sm"
                  variant="flat"
                  onPress={() => {
                    cleanup();
                    if (mediaRecorderRef.current?.state === "recording") {
                      mediaRecorderRef.current.stop();
                    }
                  }}
                >
                  停止
                </Button>
              </div>
            )}

            {state === "processing" && (
              <div className="flex flex-col items-center gap-4 py-6">
                <Spinner size="lg" />
                <p className="text-foreground-400 text-sm">识别中...</p>
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
