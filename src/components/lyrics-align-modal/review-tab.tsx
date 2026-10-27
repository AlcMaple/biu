import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Alert, Button, Input, Spinner, Tab, Tabs, addToast } from "@heroui/react";
import { RiArrowLeftLine } from "@remixicon/react";

import Empty from "@/components/empty";
import {
  AlignApiError,
  approveSubmission,
  dismissReport,
  getAlignJob,
  getReportDetail,
  getReportList,
  getReviewDetail,
  getReviewList,
  publishAlignment,
  realignByHash,
  rejectSubmission,
  resolveReport,
} from "@/service/lyrics-align";
import { useAlignReview } from "@/store/align-review";
import { usePlayList } from "@/store/play-list";
import { ALIGN_POLL_INTERVAL_MS } from "@shared/lyrics-align";

import AlignmentPreview from "./alignment-preview";
import { formatShortDate } from "./format-date";

const offsetText = (sec: number) =>
  Math.abs(sec) < 0.3 ? "和原歌词基本一致" : `原歌词整体${sec > 0 ? "快" : "慢"}了 ${Math.abs(sec).toFixed(1)} 秒`;

const SOURCE: Record<AlignPublishSource, string> = {
  auto: "自动对齐",
  upload: "用户上传",
  admin: "管理员发布",
};

const currentText = (current: LyricsAlignment | null, source: AlignPublishSource | null) =>
  current
    ? `现在在用的是${source ? SOURCE[source] : ""}的版本（${current.lines.length} 行）`
    : "这首歌现在没有在用的逐字歌词";

const message = (err: unknown) => (err instanceof AlignApiError ? err.message : String(err));

const Loading = () => (
  <div className="flex h-[40vh] items-center justify-center">
    <Spinner size="lg" label="加载中..." />
  </div>
);

const PlayButton = ({ bvid, cid, title }: { bvid: string; cid: string; title: string }) => (
  <Button
    size="sm"
    variant="flat"
    className="self-start"
    onPress={() => usePlayList.getState().play({ type: "mv", bvid, cid, title })}
  >
    播放这首试听
  </Button>
);

// 两份时间轴并排：跟着同一个播放进度逐字填色，哪一份先亮、哪一份错行一眼就能看出来。窄屏上下排
const Compare = ({
  left,
  right,
}: {
  left: { title: string; body: ReactNode };
  right: { title: string; body: ReactNode };
}) => (
  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
    {[left, right].map(col => (
      <div key={col.title} className="flex min-w-0 flex-col gap-1">
        <div className="text-sm font-medium">{col.title}</div>
        {col.body}
      </div>
    ))}
  </div>
);

const jobText = (view: AlignJobView | null) =>
  view?.state === "queued"
    ? `排队中${view.position ? `，前面还有 ${view.position} 首` : ""}`
    : view?.state === "running" && view.stage === "download"
      ? "正在获取音频"
      : "正在对齐，约 2 分钟";

// 审核页里直接重跑被报的那份歌词。结果是草稿，不影响所有人在用的版本；离开详情页服务器照样算完，回来就能看到
const useRealign = (target: { bvid: string; cid: string; lyricsHash: string }, onDone: () => void) => {
  const [view, setView] = useState<AlignJobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const settle = (next: AlignJobView) => {
    setRunning(false);
    if (next.state === "failed") setError(next.error?.message ?? "对齐失败，请稍后再试");
    else onDone();
  };
  // 查进度失败不自动重试：被限流时继续打只会更糟，原因原样给审核员
  const poll = (id: string) => {
    timer.current = setTimeout(async () => {
      try {
        const next = await getAlignJob(id);
        setView(next);
        if (next.state === "queued" || next.state === "running") poll(id);
        else settle(next);
      } catch (err) {
        setRunning(false);
        setError(message(err));
      }
    }, ALIGN_POLL_INTERVAL_MS);
  };
  const start = async () => {
    setError(null);
    setView(null);
    setRunning(true);
    try {
      const first = await realignByHash(target);
      setView(first);
      if (first.id && (first.state === "queued" || first.state === "running")) poll(first.id);
      else settle(first);
    } catch (err) {
      setRunning(false);
      setError(message(err));
    }
  };
  return { running, view, error, start };
};

const useDetail = <T,>(load: () => Promise<T>) => {
  const [detail, setDetail] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    load()
      .then(setDetail)
      .catch(err => setError(message(err)));
  }, [load]);
  useEffect(reload, [reload]);
  return { detail, error, reload };
};

// 每个操作都给出用户能看懂的结果提示，失败时原样展示服务端的文案
const useAct = (onDone: () => void) => {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (kind: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(kind);
    try {
      await fn();
      addToast({ title: done, color: "success" });
      onDone();
    } catch (err) {
      addToast({ title: message(err), color: "danger" });
    } finally {
      setBusy(null);
    }
  };
  return { busy, act };
};

const SubmissionDetail = ({ id, onDone }: { id: string; onDone: () => void }) => {
  const load = useCallback(() => getReviewDetail(id), [id]);
  const { detail, error, reload } = useDetail(load);
  const { busy, act } = useAct(onDone);
  const [reason, setReason] = useState("");

  if (error) return <Alert color="danger" title={error} />;
  if (!detail) return <Loading />;
  const { submission, alignment, failure, current, currentSource } = detail;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm">
        <div className="font-medium">{submission.title}</div>
        <div className="text-foreground-500 text-xs tabular-nums">
          {submission.bvid} · 上传者 UID {submission.mid} · {formatShortDate(submission.createdAt)} 上传
        </div>
        {submission.note ? <div className="text-foreground/80 mt-1">备注：{submission.note}</div> : null}
      </div>
      {alignment ? (
        <>
          <div className="text-foreground-500 flex flex-wrap gap-x-4 text-xs">
            <span>{alignment.lines.length} 行</span>
            {alignment.quality.repairedLines ? <span>{alignment.quality.repairedLines} 行二次校准过</span> : null}
            {/* 外语歌靠「和原歌词时间吻合多少」判断歌词配没配错；纯文本外语歌词服务端判不了，只能靠审核员试听 */}
            {alignment.quality.lang && alignment.quality.lang !== "zh" ? (
              <span>
                {typeof alignment.quality.timelineMatch === "number"
                  ? `${Math.round(alignment.quality.timelineMatch * 100)}% 的行和原歌词时间吻合`
                  : "外语纯文本歌词，服务端判断不了配没配错，请试听确认"}
              </span>
            ) : null}
            {/* 带时间的原歌词才有：整体偏得多说明投稿有片头，或者歌词对应的是另一个版本。
                纯文本上传服务端给的偏移恒为 0，照样显示会读成「和原歌词基本一致」 */}
            <span>
              {submission.lines.some(l => l.t) ? offsetText(alignment.offsetSec) : "上传的是纯文本，时间全部来自音频"}
            </span>
            <span>{currentText(current, currentSource)}，通过后替换它</span>
          </div>
          <PlayButton {...submission} />
          {current ? (
            <Compare
              left={{ title: "这次上传的", body: <AlignmentPreview alignment={alignment} /> }}
              right={{
                title: `现在在用的（${current.lines.length} 行）`,
                body: <AlignmentPreview alignment={current} />,
              }}
            />
          ) : (
            <AlignmentPreview alignment={alignment} />
          )}
        </>
      ) : failure ? (
        <Alert color="warning" title={`服务器对齐这份歌词失败：${failure.message}`} />
      ) : (
        <Alert
          color="default"
          title="服务器还在对齐这份歌词（每首约 2 分钟，可能在排队），好了才能试听和通过"
          endContent={
            <Button size="sm" variant="flat" onPress={reload}>
              刷新
            </Button>
          }
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          size="sm"
          className="min-w-0 flex-1"
          value={reason}
          onValueChange={setReason}
          placeholder="打回原因（打回时必填，上传的人能看到）"
          maxLength={200}
        />
        <Button
          color="danger"
          variant="flat"
          isDisabled={!reason.trim()}
          isLoading={busy === "reject"}
          onPress={() =>
            act("reject", () => rejectSubmission(id, reason.trim()), "已打回，上传的人能在「我的提交」看到原因")
          }
        >
          打回
        </Button>
        <Button
          color="success"
          isDisabled={!alignment}
          isLoading={busy === "approve"}
          onPress={() => act("approve", () => approveSubmission(id), "已通过，所有人打开这首歌都会用它")}
        >
          通过
        </Button>
      </div>
    </div>
  );
};

const ReportDetail = ({ id, onDone }: { id: string; onDone: () => void }) => {
  const load = useCallback(() => getReportDetail(id), [id]);
  const { detail, error, reload } = useDetail(load);
  const { busy, act } = useAct(onDone);
  const [reason, setReason] = useState("");
  const target = detail?.report ?? { bvid: "", cid: "", lyricsHash: "" };
  const realign = useRealign(target, reload);

  if (error) return <Alert color="danger" title={error} />;
  if (!detail) return <Loading />;
  const { report, alignment, current, currentSource, draft, canRealign } = detail;
  // 报错之后这首歌可能已经换过版本；只有被报的那份还在用，下线 / 替换才有意义
  const stillInUse = current?.lyricsHash === report.lyricsHash;
  const busyAny = Boolean(busy) || realign.running;

  const rerunButton = (label: string) => (
    <Button size="sm" variant="flat" className="self-start" isLoading={realign.running} onPress={realign.start}>
      {label}
    </Button>
  );
  const draftBody = draft ? (
    <>
      <div className="text-foreground-500 flex flex-wrap items-center gap-x-3 text-xs">
        <span>还没发布，所有人在用的仍是左边那份</span>
        {rerunButton("再跑一遍")}
      </div>
      <AlignmentPreview alignment={draft} />
    </>
  ) : (
    <div className="border-default-200 flex min-h-32 flex-col justify-center gap-2 rounded-md border border-dashed p-3 text-xs">
      {realign.running ? (
        <span className="text-foreground-500">{jobText(realign.view)}，离开这页也会照常算完</span>
      ) : canRealign ? (
        <>
          <span className="text-foreground-500">
            判断不了是算法还是歌词的问题时，用同一份歌词插队重跑一遍对照；结果先不发布
          </span>
          {rerunButton("重新对齐对照")}
        </>
      ) : (
        <span className="text-foreground-500">
          服务器上没存这份歌词的原文（对齐得比较早），要重跑请播放这首，在歌词区的逐字歌词菜单里「重新对齐当前歌词」
        </span>
      )}
      {realign.error ? <span className="text-danger">{realign.error}</span> : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm">
        <div className="font-medium">{report.title}</div>
        <div className="text-foreground-500 text-xs tabular-nums">
          {report.bvid} · 报错者 UID {report.mid} · {formatShortDate(report.createdAt)} 报错
        </div>
        <div className="text-foreground/80 mt-1">{report.note ? `说明：${report.note}` : "没写说明"}</div>
      </div>
      <div className="text-foreground-500 flex flex-wrap gap-x-4 text-xs">
        <span>{report.wasPublished ? "报的是当时所有人在用的版本" : "报的是报错人自己换过的歌词，不影响其他人"}</span>
        <span>{stillInUse ? "这份现在仍在用" : currentText(current, currentSource)}</span>
      </div>
      <PlayButton {...report} />
      <Compare
        left={{
          title: "被报的版本",
          body: alignment ? (
            <AlignmentPreview alignment={alignment} />
          ) : (
            <Alert color="warning" title="被报的这份对齐结果已经不在服务器上了（算法升级过或清理过）" />
          ),
        }}
        right={{ title: "重新对齐的结果", body: draftBody }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          size="sm"
          className="min-w-0 flex-1"
          value={reason}
          onValueChange={setReason}
          placeholder="给报错人的说明（驳回时必填）"
          maxLength={200}
        />
        <Button
          variant="flat"
          isDisabled={!reason.trim() || busyAny}
          isLoading={busy === "dismiss"}
          onPress={() => act("dismiss", () => dismissReport(id, reason.trim()), "已驳回，报错人能看到说明")}
        >
          没问题，驳回
        </Button>
        {stillInUse ? (
          <>
            <Button
              color="danger"
              variant="flat"
              isDisabled={busyAny}
              isLoading={busy === "withdraw"}
              onPress={() =>
                act(
                  "withdraw",
                  () => resolveReport(id, { withdraw: true, reason: reason.trim() || undefined }),
                  "已下线，所有人退回原来的歌词；这份不会再被自动对齐换回来",
                )
              }
            >
              下线，退回原歌词
            </Button>
            <Button
              color="success"
              isDisabled={!draft || busyAny}
              isLoading={busy === "replace"}
              onPress={() =>
                act(
                  "replace",
                  () => publishAlignment({ bvid: report.bvid, cid: report.cid, lyricsHash: report.lyricsHash }),
                  "已换成重新对齐的结果，所有人打开这首歌都会用它；这首歌的报错已一并关闭",
                )
              }
            >
              用重跑结果替换
            </Button>
          </>
        ) : (
          <Button
            color="success"
            isDisabled={busyAny}
            isLoading={busy === "close"}
            onPress={() =>
              act(
                "close",
                () => resolveReport(id, { withdraw: false, reason: reason.trim() || "这首歌已经换过版本" }),
                "已关闭，报错人能看到处理结果",
              )
            }
          >
            已换过版本，关闭报错
          </Button>
        )}
      </div>
    </div>
  );
};

type Kind = "uploads" | "reports";

const List = ({
  kind,
  items,
  onSelect,
}: {
  kind: Kind;
  items: (AlignSubmissionBrief | AlignReport)[];
  onSelect: (id: string) => void;
}) => {
  if (!items.length)
    return <Empty title={kind === "uploads" ? "没有待审核的上传" : "没有待处理的报错"} className="h-[40vh]" />;
  return (
    <div className="flex flex-col gap-0.5 pb-4">
      {items.map(item => {
        const meta: ReactNode =
          "lineCount" in item
            ? `${item.lineCount} 行 · 上传者 UID ${item.mid} · ${formatShortDate(item.createdAt)} 上传`
            : `报错者 UID ${item.mid} · ${formatShortDate(item.createdAt)} 报错`;
        const note = "lineCount" in item ? item.note && `备注：${item.note}` : item.note && `说明：${item.note}`;
        return (
          <button
            type="button"
            key={item.id}
            onClick={() => onSelect(item.id)}
            className="hover:bg-content2 flex w-full min-w-0 flex-col gap-1 rounded-md px-2 py-2 text-left"
          >
            <span className="w-full truncate text-sm font-medium">{item.title}</span>
            <span className="text-foreground-500 text-xs tabular-nums">{meta}</span>
            {note ? <span className="text-foreground/70 text-xs">{note}</span> : null}
          </button>
        );
      })}
    </div>
  );
};

// 管理员只处理两类事：用户上传的歌词、用户对时间轴的报错。自动对齐的结果不经审核直接生效
const ReviewTab = () => {
  const [data, setData] = useState<{ uploads: AlignSubmissionBrief[]; reports: AlignReport[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("uploads");
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    setSelected(null);
    try {
      const [uploads, reports] = await Promise.all([getReviewList("pending"), getReportList("pending")]);
      const oldestFirst = <T extends { createdAt: number }>(list: T[]) =>
        list.toSorted((a, b) => a.createdAt - b.createdAt);
      setData({ uploads: oldestFirst(uploads.items), reports: oldestFirst(reports.items) });
      useAlignReview.setState({ isAdmin: true, pendingCount: uploads.items.length + reports.items.length });
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
  if (!data) return <Loading />;
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
          返回列表
        </Button>
        {kind === "uploads" ? (
          <SubmissionDetail id={selected} onDone={load} />
        ) : (
          <ReportDetail id={selected} onDone={load} />
        )}
      </div>
    );
  }

  return (
    <>
      <Tabs selectedKey={kind} onSelectionChange={key => setKind(key as Kind)} size="sm" className="mb-2">
        <Tab key="uploads" title={`用户上传${data.uploads.length ? ` ${data.uploads.length}` : ""}`} />
        <Tab key="reports" title={`时间轴报错${data.reports.length ? ` ${data.reports.length}` : ""}`} />
      </Tabs>
      <List kind={kind} items={kind === "uploads" ? data.uploads : data.reports} onSelect={setSelected} />
    </>
  );
};

export default ReviewTab;
