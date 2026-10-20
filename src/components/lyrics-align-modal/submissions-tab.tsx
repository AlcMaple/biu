import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, Chip, Spinner, Tab, Tabs } from "@heroui/react";

import Empty from "@/components/empty";
import { AlignApiError, getMyReports, getMySubmissions } from "@/service/lyrics-align";
import { usePlayList } from "@/store/play-list";

import { formatShortDate } from "./format-date";

type ChipColor = "warning" | "success" | "danger" | "default";

const UPLOAD_STATUS: Record<AlignSubmissionStatus, { label: string; color: ChipColor }> = {
  pending: { label: "待审核", color: "warning" },
  approved: { label: "已通过", color: "success" },
  rejected: { label: "被打回", color: "danger" },
  withdrawn: { label: "已撤回", color: "default" },
  superseded: { label: "已有更新的版本", color: "default" },
};

const reportStatus = (r: AlignReport): { label: string; color: ChipColor } =>
  r.status === "pending"
    ? { label: "待处理", color: "warning" }
    : r.status === "dismissed"
      ? { label: "没发现问题", color: "default" }
      : { label: r.withdrawn ? "已下线" : "已处理", color: "success" };

interface Row {
  id: string;
  kind: "upload" | "report";
  bvid: string;
  cid: string;
  title: string;
  meta: string;
  status: { label: string; color: ChipColor };
  reason?: string;
  createdAt: number;
}

const toRows = (uploads: AlignSubmissionBrief[], reports: AlignReport[]): Row[] =>
  [
    ...uploads.map<Row>(u => ({
      ...u,
      kind: "upload",
      meta: `上传 ${u.lineCount} 行 · ${formatShortDate(u.createdAt)}`,
      status: UPLOAD_STATUS[u.status],
      reason: u.status === "rejected" && u.reason ? `打回原因：${u.reason}` : undefined,
    })),
    ...reports.map<Row>(r => ({
      ...r,
      kind: "report",
      meta: `报错时间轴 · ${formatShortDate(r.createdAt)}`,
      status: reportStatus(r),
      reason: r.status !== "pending" && r.reason ? `管理员说明：${r.reason}` : undefined,
    })),
  ].toSorted((a, b) => b.createdAt - a.createdAt);

type Filter = "all" | "upload" | "report";

const SubmissionsTab = () => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    try {
      const [uploads, reports] = await Promise.all([getMySubmissions(), getMyReports()]);
      setRows(toRows(uploads.items, reports.items));
    } catch (err) {
      setError(err instanceof AlignApiError ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => (rows ?? []).filter(row => filter === "all" || row.kind === filter), [rows, filter]);

  return (
    <>
      <Tabs selectedKey={filter} onSelectionChange={key => setFilter(key as Filter)} size="sm" className="mb-2">
        <Tab key="all" title="全部" />
        <Tab key="upload" title="上传的歌词" />
        <Tab key="report" title="报错" />
      </Tabs>

      {error ? (
        <div className="flex h-[40vh] flex-col items-center justify-center gap-3">
          <span className="text-danger text-sm">{error}</span>
          <Button size="sm" variant="flat" onPress={load}>
            重新加载
          </Button>
        </div>
      ) : !rows ? (
        <div className="flex h-[40vh] items-center justify-center">
          <Spinner size="lg" label="加载中..." />
        </div>
      ) : !shown.length ? (
        <Empty
          title={
            filter === "all" ? "还没有上传过歌词或报过错，可以在歌词区右下角的逐字歌词菜单里操作" : "这一类下面没有记录"
          }
          className="h-[40vh]"
        />
      ) : (
        <div className="flex flex-col gap-0.5 pb-4">
          {shown.map(row => (
            <div
              key={row.id}
              role="button"
              tabIndex={0}
              onClick={() =>
                usePlayList.getState().play({ type: "mv", bvid: row.bvid, cid: row.cid, title: row.title })
              }
              className="hover:bg-content2 flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-md px-2 py-2"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm font-medium" title={row.title}>
                  {row.title}
                </span>
                <span className="text-foreground-500 text-xs tabular-nums">{row.meta}</span>
                {row.reason ? <span className="text-foreground/70 text-xs">{row.reason}</span> : null}
              </div>
              <Chip size="sm" radius="sm" variant="flat" color={row.status.color} className="flex-none">
                {row.status.label}
              </Chip>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default SubmissionsTab;
