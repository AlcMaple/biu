import { useCallback, useEffect, useState } from "react";

import { Button, Chip, Input, Spinner, Tab, Tabs, addToast } from "@heroui/react";

import { FEEDBACK_KIND_LABEL } from "@/components/feedback-modal";
import { formatShortDate } from "@/components/lyrics-align-modal/format-date";
import Empty from "@/components/empty";
import ScrollContainer from "@/components/scroll-container";
import { AlignApiError, getFeedbackList, markFeedbackDone } from "@/service/lyrics-align";
import { useAlignReview } from "@/store/align-review";

type Status = "pending" | "done";

const FeedbackReview = () => {
  const [status, setStatus] = useState<Status>("pending");
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});

  const load = useCallback(async (s: Status) => {
    setItems(null);
    setError(null);
    try {
      setItems((await getFeedbackList(s)).items);
    } catch (err) {
      setError(err instanceof AlignApiError ? err.message : "加载反馈失败");
    }
  }, []);

  useEffect(() => {
    void load(status);
  }, [status, load]);

  const done = async (id: string) => {
    try {
      await markFeedbackDone(id, replies[id]?.trim() || undefined);
      setItems(list => list?.filter(i => i.id !== id) ?? null);
      void useAlignReview.getState().refresh();
    } catch (err) {
      addToast({ title: err instanceof AlignApiError ? err.message : "操作失败", color: "danger" });
    }
  };

  return (
    <ScrollContainer pageScroll enableBackToTop className="h-full w-full px-4">
      <div className="mb-2">
        <h1>用户反馈</h1>
      </div>
      <Tabs selectedKey={status} onSelectionChange={k => setStatus(k as Status)} className="mb-2">
        <Tab key="pending" title="待处理" />
        <Tab key="done" title="已处理" />
      </Tabs>
      {error ? (
        <Empty title={error} />
      ) : !items ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : !items.length ? (
        <Empty title="暂无反馈" />
      ) : (
        <ul className="space-y-3 pb-6">
          {items.map(item => (
            <li key={item.id} className="bg-content2 rounded-medium space-y-2 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Chip size="sm" color={item.kind === "bug" ? "danger" : "primary"} variant="flat">
                  {FEEDBACK_KIND_LABEL[item.kind]}
                </Chip>
                <span className="text-foreground-500">
                  UID {item.mid} · {item.platform} {item.appVersion} · {formatShortDate(item.createdAt)}
                </span>
              </div>
              <p className="break-words whitespace-pre-wrap">{item.content}</p>
              {item.status === "pending" ? (
                <div className="flex gap-2">
                  <Input
                    size="sm"
                    aria-label="回复"
                    maxLength={200}
                    placeholder="处理说明（可选，用户可见）"
                    value={replies[item.id] ?? ""}
                    onValueChange={v => setReplies(r => ({ ...r, [item.id]: v }))}
                  />
                  <Button size="sm" color="primary" onPress={() => done(item.id)}>
                    标记已处理
                  </Button>
                </div>
              ) : (
                item.reply && <p className="text-foreground-500 text-sm">处理说明：{item.reply}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </ScrollContainer>
  );
};

export default FeedbackReview;
