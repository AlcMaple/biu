import { useCallback, useEffect, useState } from "react";

import { Alert, Button, Input, Spinner, addToast } from "@heroui/react";

import {
  AlignApiError,
  approveSubmission,
  getReviewDetail,
  getReviewList,
  rejectSubmission,
} from "@/service/lyrics-align";
import { useAlignReview } from "@/store/align-review";
import { usePlayList } from "@/store/play-list";

import AlignmentPreview from "./alignment-preview";

const formatDate = (ts: number) => new Date(ts).toLocaleString();

const message = (err: unknown) => (err instanceof AlignApiError ? err.message : String(err));

const Detail = ({ id, onDone }: { id: string; onDone: () => void }) => {
  const [detail, setDetail] = useState<AlignSubmissionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  useEffect(() => {
    let canceled = false;
    getReviewDetail(id)
      .then(res => !canceled && setDetail(res))
      .catch(err => !canceled && setError(message(err)));
    return () => {
      canceled = true;
    };
  }, [id]);

  const act = async (kind: "approve" | "reject") => {
    setBusy(kind);
    try {
      if (kind === "approve") await approveSubmission(id);
      else await rejectSubmission(id, reason.trim());
      addToast({
        title: kind === "approve" ? "已通过，这首歌对所有人生效" : "已打回，上传者能看到原因",
        color: "success",
      });
      onDone();
    } catch (err) {
      addToast({ title: message(err), color: "danger" });
    } finally {
      setBusy(null);
    }
  };

  if (error) return <Alert color="danger" title={error} />;
  if (!detail) return <Spinner className="m-auto" />;
  const { submission, alignment, current } = detail;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm">
        <div className="font-medium">{submission.title}</div>
        <div className="text-foreground/60 text-xs">
          {submission.bvid} · cid {submission.cid} · 上传者 UID {submission.mid} · {formatDate(submission.createdAt)}
        </div>
        {submission.note ? <div className="text-foreground/80 mt-1">备注：{submission.note}</div> : null}
      </div>
      {alignment ? (
        <>
          <div className="text-foreground/70 flex flex-wrap gap-x-4 text-xs">
            <span>置信度中位数 {alignment.quality.medianScore.toFixed(2)}</span>
            <span>局部重对齐 {alignment.quality.repairedLines} 行</span>
            {/* 带时间的原歌词才有：整体偏得多说明投稿有片头，或者歌词对应的是另一个版本 */}
            <span>比原歌词整体偏移 {alignment.offsetSec.toFixed(2)} 秒</span>
            {current ? <span>当前在用版本 {current.lines.length} 行</span> : <span>这首歌还没有在用的版本</span>}
          </div>
          <Button
            size="sm"
            variant="flat"
            className="self-start"
            onPress={() =>
              usePlayList
                .getState()
                .play({ type: "mv", bvid: submission.bvid, cid: submission.cid, title: submission.title })
            }
          >
            播放这首试听
          </Button>
          <AlignmentPreview alignment={alignment} />
        </>
      ) : (
        <Alert
          color="warning"
          title="这条提交的对齐结果已经不在缓存里（算法升级或清理过），不能通过，可以打回让上传者重新对齐"
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          size="sm"
          className="min-w-0 flex-1"
          value={reason}
          onValueChange={setReason}
          placeholder="打回原因（打回时必填，上传者能看到）"
          maxLength={200}
        />
        <Button
          color="danger"
          variant="flat"
          isDisabled={!reason.trim()}
          isLoading={busy === "reject"}
          onPress={() => act("reject")}
        >
          打回
        </Button>
        <Button color="success" isDisabled={!alignment} isLoading={busy === "approve"} onPress={() => act("approve")}>
          通过
        </Button>
      </div>
    </div>
  );
};

const ReviewTab = () => {
  const [items, setItems] = useState<AlignSubmissionBrief[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setItems(null);
    setSelected(null);
    try {
      const { items: pending } = await getReviewList("pending");
      setItems(pending.toSorted((a, b) => a.createdAt - b.createdAt));
      useAlignReview.setState({ isAdmin: true, pendingCount: pending.length });
    } catch (err) {
      setError(message(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <Alert
        color="danger"
        title={error}
        endContent={
          <Button size="sm" variant="flat" color="danger" onPress={load}>
            重新加载
          </Button>
        }
      />
    );
  }
  if (!items) return <Spinner className="m-auto" />;
  if (selected) {
    return (
      <div className="flex flex-col gap-3">
        <Button size="sm" variant="light" className="self-start" onPress={() => setSelected(null)}>
          ← 返回待审列表
        </Button>
        <Detail id={selected} onDone={load} />
      </div>
    );
  }
  if (!items.length) return <div className="text-foreground/60 py-8 text-center text-sm">没有待审核的提交</div>;

  return (
    <div className="flex flex-col gap-2">
      {items.map(item => (
        <button
          type="button"
          key={item.id}
          onClick={() => setSelected(item.id)}
          className="border-default-200 rounded-medium border px-3 py-2 text-left"
        >
          <div className="truncate text-sm font-medium">{item.title}</div>
          <div className="text-foreground/50 mt-1 text-xs">
            {item.bvid} · {item.lineCount} 行 · UID {item.mid} · {formatDate(item.createdAt)}
          </div>
          {item.note ? <div className="text-foreground/70 mt-1 text-xs">备注：{item.note}</div> : null}
        </button>
      ))}
    </div>
  );
};

export default ReviewTab;
