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
  Select,
  SelectItem,
  Textarea,
  addToast,
} from "@heroui/react";

import { AlignApiError, reportAlignment } from "@/service/lyrics-align";
import { currentAlignTarget } from "@/store/lyrics-align-session";

import { TRACK_LABEL } from "./report-scope";

export interface ReportSubject {
  lyricsHash: string;
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
  const tracks = (["original", "translation", "romanization"] as const).filter(
    track => track === "original" || lines.some(l => l[track]),
  );
  const [track, setTrack] = useState<AlignReportTrack>("original");
  // 起止行都留空 = 整首；只选了起始行 = 只报这一行
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // 失败写在弹窗里而不是 toast，理由同上传弹窗：toast 会盖住「发送」按钮
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lyricsHash) return;
    setNote("");
    setTrack("original");
    setFrom(null);
    setTo(null);
    setError(null);
  }, [lyricsHash]);

  const send = async () => {
    const target = currentAlignTarget();
    if (!target || !lyricsHash) return;
    const last = to ?? from;
    if (from !== null && last !== null && last < from) {
      setError("结束行不能在起始行前面");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reportAlignment({
        bvid: target.bvid,
        cid: target.cid,
        lyricsHash,
        note: note.trim() || undefined,
        track,
        ...(from !== null ? { fromLine: from, toLine: last ?? from } : {}),
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
          <span className="text-foreground/60 text-sm font-normal">管理员会带着译文和罗马音一起看你选的那一段</span>
        </ModalHeader>
        <ModalBody>
          {tracks.length > 1 ? (
            <RadioGroup
              orientation="horizontal"
              size="sm"
              label="哪里不对"
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
          <div className="flex gap-2">
            {(
              [
                ["起始行（不选 = 整首）", from, setFrom],
                ["结束行", to, setTo],
              ] as const
            ).map(([label, value, set]) => (
              <Select
                key={label}
                size="sm"
                label={label}
                selectedKeys={value === null ? [] : [String(value)]}
                onSelectionChange={keys => {
                  const key = [...keys][0];
                  set(key === undefined ? null : Number(key));
                }}
              >
                {lines.map((line, index) => (
                  <SelectItem key={String(index + 1)} textValue={`${index + 1}. ${line.text}`}>
                    {`${index + 1}. ${line.text}`}
                  </SelectItem>
                ))}
              </Select>
            ))}
          </div>
          <Textarea
            value={note}
            onValueChange={setNote}
            minRows={3}
            maxLength={200}
            placeholder="具体情况（可选），比如「第二段整体慢半拍」「译文错位了一行」"
            aria-label="哪里不对"
          />
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
