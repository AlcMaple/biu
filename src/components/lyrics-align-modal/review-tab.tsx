import { useCallback, useEffect, useState } from "react";

import { Alert, Button, Input, Spinner, addToast } from "@heroui/react";
import { RiArrowLeftLine } from "@remixicon/react";

import Empty from "@/components/empty";
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
import { formatShortDate } from "./format-date";

const offsetText = (sec: number) =>
  Math.abs(sec) < 0.3 ? "和原歌词基本一致" : `原歌词整体${sec > 0 ? "快" : "慢"}了 ${Math.abs(sec).toFixed(1)} 秒`;

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
        title: kind === "approve" ? "已通过，所有人打开这首歌都会用它" : "已打回，提交的人能在「我的提交」看到原因",
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
  if (!detail)
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <Spinner size="lg" label="加载中..." />
      </div>
    );
  const { submission, alignment, current } = detail;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm">
        <div className="font-medium">{submission.title}</div>
        <div className="text-foreground-500 text-xs tabular-nums">
          {submission.bvid} · 提交者 UID {submission.mid} · {formatShortDate(submission.createdAt)} 提交
        </div>
        {submission.note ? <div className="text-foreground/80 mt-1">备注：{submission.note}</div> : null}
      </div>
      {alignment ? (
        <>
          <div className="text-foreground-500 flex flex-wrap gap-x-4 text-xs">
            <span>{alignment.lines.length} 行</span>
            {alignment.quality.repairedLines ? <span>{alignment.quality.repairedLines} 行二次校准过</span> : null}
            {/* 带时间的原歌词才有：整体偏得多说明投稿有片头，或者歌词对应的是另一个版本 */}
            <span>{offsetText(alignment.offsetSec)}</span>
            <span>{current ? `会替换现在在用的版本（${current.lines.length} 行）` : "这首歌还没有在用的逐字歌词"}</span>
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
          title="这条提交的对齐结果已经不在服务器上了（对齐算法升级过或清理过），不能通过；可以打回，请提交的人重新对齐后再交"
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          size="sm"
          className="min-w-0 flex-1"
          value={reason}
          onValueChange={setReason}
          placeholder="打回原因（打回时必填，提交的人能看到）"
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
  if (!items)
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <Spinner size="lg" label="加载中..." />
      </div>
    );
  if (selected) {
    return (
      <div className="flex flex-col gap-3">
        <Button
          size="sm"
          variant="light"
          className="self-start"
          startContent={<RiArrowLeftLine size={16} />}
          onPress={() => setSelected(null)}
        >
          返回待审列表
        </Button>
        <Detail id={selected} onDone={load} />
      </div>
    );
  }
  if (!items.length) return <Empty title="没有待审核的提交" className="h-[40vh]" />;

  return (
    <div className="flex flex-col gap-0.5 pb-4">
      {items.map(item => (
        <button
          type="button"
          key={item.id}
          onClick={() => setSelected(item.id)}
          className="hover:bg-content2 flex w-full min-w-0 flex-col gap-1 rounded-md px-2 py-2 text-left"
        >
          <span className="w-full truncate text-sm font-medium">{item.title}</span>
          <span className="text-foreground-500 text-xs tabular-nums">
            {item.lineCount} 行 · 提交者 UID {item.mid} · {formatShortDate(item.createdAt)} 提交
          </span>
          {item.note ? <span className="text-foreground/70 text-xs">备注：{item.note}</span> : null}
        </button>
      ))}
    </div>
  );
};

export default ReviewTab;
