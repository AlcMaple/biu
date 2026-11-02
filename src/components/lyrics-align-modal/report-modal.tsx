import { useEffect, useState } from "react";

import {
  Alert,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Radio,
  RadioGroup,
  Textarea,
  addToast,
} from "@heroui/react";

import { AlignApiError, reportAlignment } from "@/service/lyrics-align";
import { currentAlignTarget } from "@/store/lyrics-align-session";

import {
  OTHER_NOTE_MAX,
  OTHER_NOTE_MIN,
  OTHER_TYPE_LABEL,
  TRACK_LABEL,
  isCorrectionChanged,
  reportTracks,
  trackLines,
} from "./report-scope";

export interface ReportSubject {
  lyricsHash: string;
  quality?: Pick<LyricsAlignment["quality"], "lang">;
  lines: Pick<AlignedLyricLine, "text" | "translation" | "romanization">[];
}

interface Props {
  // 报的是正在显示的那份逐字歌词；没有逐字歌词时不打开
  subject: ReportSubject | null;
  onClose: () => void;
}

const ReportModal = ({ subject, onClose }: Props) => {
  const lyricsHash = subject?.lyricsHash ?? null;
  const lines = subject?.lines ?? [];
  const tracks = reportTracks(subject?.quality?.lang, lines);
  const [kind, setKind] = useState<"text" | "other">("text");
  const [otherType, setOtherType] = useState<AlignReportOtherType | null>(null);
  const [track, setTrack] = useState<AlignReportTrack>("original");
  // 把这一轨现在的歌词放进输入框让用户直接改，发给管理员的是改好的整份，不是一句「哪里不对」
  const [edited, setEdited] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // 失败写在弹窗里而不是 toast，理由同上传弹窗：toast 会盖住「发送」按钮
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lyricsHash) return;
    setNote("");
    setKind("text");
    setOtherType(null);
    setTrack("original");
    setError(null);
  }, [lyricsHash]);

  const original = trackLines(lines, track);
  const originalKey = original.join("\n");
  useEffect(() => {
    setEdited(originalKey);
    setError(null);
  }, [lyricsHash, track, originalKey]);

  const send = async () => {
    const target = currentAlignTarget();
    if (!target || !lyricsHash) return;
    if (kind === "other" && (!otherType || note.trim().length < OTHER_NOTE_MIN)) {
      setError(otherType ? `请用 ${OTHER_NOTE_MIN}-${OTHER_NOTE_MAX} 个字描述具体的错误` : "请选择错误类型");
      return;
    }
    if (kind === "text" && !isCorrectionChanged(original, edited)) {
      setError("歌词还没有改动，改完再发送");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reportAlignment({
        bvid: target.bvid,
        cid: target.cid,
        lyricsHash,
        note: kind === "other" ? note.trim() : undefined,
        kind,
        ...(kind === "other" ? { otherType: otherType! } : { track, corrected: edited }),
      });
      addToast({
        title: "已告诉管理员，谢谢",
        description: "处理结果在侧边栏「我的提交」里",
        color: "success",
      });
      onClose();
    } catch (err) {
      setError(err instanceof AlignApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={Boolean(subject)} onOpenChange={open => !open && onClose()} disableAnimation>
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          歌词报错
          <span className="text-foreground/60 text-sm font-normal">管理员会处理，结果在侧边栏「我的提交」里</span>
        </ModalHeader>
        <ModalBody>
          <RadioGroup
            orientation="horizontal"
            size="sm"
            label="错误类型"
            value={kind}
            onValueChange={value => {
              setKind(value as "text" | "other");
              setError(null);
            }}
          >
            <Radio value="text">歌词文本错误</Radio>
            <Radio value="other">其他错误</Radio>
          </RadioGroup>
          {kind === "text" ? (
            <>
              {tracks.length > 1 ? (
                <RadioGroup
                  orientation="horizontal"
                  size="sm"
                  label="要改哪里"
                  value={track}
                  onValueChange={value => setTrack(value as AlignReportTrack)}
                >
                  {tracks.map(item => (
                    <Radio key={item} value={item}>
                      {TRACK_LABEL[item]}
                    </Radio>
                  ))}
                </RadioGroup>
              ) : null}
              {tracks.length === 1 ? <div className="text-small">{TRACK_LABEL[track]}</div> : null}
              <Textarea
                value={edited}
                onValueChange={value => {
                  setEdited(value);
                  setError(null);
                }}
                minRows={8}
                maxRows={14}
                maxLength={20000}
                description="直接在上面改，一行一句，改好后发送"
                aria-label={`${TRACK_LABEL[track]}（可修改）`}
              />
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(OTHER_TYPE_LABEL) as AlignReportOtherType[]).map(item => (
                  <Button
                    key={item}
                    size="sm"
                    radius="full"
                    variant={otherType === item ? "solid" : "bordered"}
                    color={otherType === item ? "primary" : "default"}
                    aria-pressed={otherType === item}
                    onPress={() => setOtherType(item)}
                  >
                    {OTHER_TYPE_LABEL[item]}
                  </Button>
                ))}
              </div>
              <Textarea
                value={note}
                onValueChange={setNote}
                minRows={4}
                maxLength={OTHER_NOTE_MAX}
                placeholder={`请描述具体的错误（${OTHER_NOTE_MIN}-${OTHER_NOTE_MAX} 字）`}
                aria-label="错误描述"
              />
            </>
          )}
          {error ? <Alert color="danger" title={error} /> : null}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            取消
          </Button>
          <Button color="primary" isLoading={busy} onPress={() => void send()}>
            发送
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ReportModal;
