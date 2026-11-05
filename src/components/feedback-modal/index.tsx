import { useState } from "react";

import {
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

import platform, { isWeb } from "@/platform";
import { AlignApiError, sendFeedback } from "@/service/lyrics-align";

export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = { bug: "问题反馈", feature: "功能建议" };

const MIN_CHARS = 5;
const MAX_CHARS = 2000;

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const FeedbackModal = ({ isOpen, onOpenChange }: Props) => {
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  // 失败写在弹窗里而不是 toast：toast 会盖住「发送」按钮，且要保留用户已经写好的内容
  const [error, setError] = useState<string | null>(null);

  const submit = async (onClose: () => void) => {
    if (content.trim().length < MIN_CHARS) {
      setError(`请至少写 ${MIN_CHARS} 个字，说清楚具体情况`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendFeedback({
        kind,
        content: content.trim(),
        appVersion: (await platform.getAppVersion()) || "",
        platform: isWeb ? "web" : "app",
      });
      addToast({ title: "已收到，感谢反馈", color: "success" });
      setContent("");
      onClose();
    } catch (err) {
      setError(err instanceof AlignApiError ? err.message : "发送失败，请稍后再试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} placement="center" shouldBlockScroll={false}>
      <ModalContent>
        {onClose => (
          <>
            <ModalHeader>问题反馈与功能建议</ModalHeader>
            <ModalBody>
              <RadioGroup orientation="horizontal" value={kind} onValueChange={v => setKind(v as FeedbackKind)}>
                <Radio value="bug">{FEEDBACK_KIND_LABEL.bug}</Radio>
                <Radio value="feature">{FEEDBACK_KIND_LABEL.feature}</Radio>
              </RadioGroup>
              <Textarea
                aria-label="反馈内容"
                minRows={5}
                maxLength={MAX_CHARS}
                placeholder={kind === "bug" ? "遇到了什么问题？在哪个页面、做了什么操作" : "希望增加什么功能？想解决什么问题"}
                value={content}
                onValueChange={v => {
                  setContent(v);
                  setError(null);
                }}
                isInvalid={Boolean(error)}
                errorMessage={error}
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                取消
              </Button>
              <Button color="primary" isLoading={busy} onPress={() => submit(onClose)}>
                发送
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};

export default FeedbackModal;
