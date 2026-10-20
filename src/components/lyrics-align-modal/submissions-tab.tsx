import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, Chip, Spinner, Tab, Tabs } from "@heroui/react";

import Empty from "@/components/empty";
import { AlignApiError, getMySubmissions } from "@/service/lyrics-align";
import { usePlayList } from "@/store/play-list";

import { formatShortDate } from "./format-date";

const STATUS: Record<AlignSubmissionStatus, { label: string; color: "warning" | "success" | "danger" | "default" }> = {
  pending: { label: "待审核", color: "warning" },
  approved: { label: "已通过", color: "success" },
  rejected: { label: "被打回", color: "danger" },
  withdrawn: { label: "已撤回", color: "default" },
  superseded: { label: "已有更新的版本", color: "default" },
};

type Filter = "all" | "pending" | "approved" | "rejected";

const SubmissionsTab = () => {
  const [items, setItems] = useState<AlignSubmissionBrief[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    setError(null);
    setItems(null);
    try {
      setItems((await getMySubmissions()).items.toSorted((a, b) => b.createdAt - a.createdAt));
    } catch (err) {
      setError(err instanceof AlignApiError ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(
    () => (items ?? []).filter(item => filter === "all" || item.status === filter),
    [items, filter],
  );

  return (
    <>
      <Tabs selectedKey={filter} onSelectionChange={key => setFilter(key as Filter)} size="sm" className="mb-2">
        <Tab key="all" title="全部" />
        <Tab key="pending" title="待审核" />
        <Tab key="approved" title="已通过" />
        <Tab key="rejected" title="被打回" />
      </Tabs>

      {error ? (
        <div className="flex h-[40vh] flex-col items-center justify-center gap-3">
          <span className="text-danger text-sm">{error}</span>
          <Button size="sm" variant="flat" onPress={load}>
            重新加载
          </Button>
        </div>
      ) : !items ? (
        <div className="flex h-[40vh] items-center justify-center">
          <Spinner size="lg" label="加载中..." />
        </div>
      ) : !shown.length ? (
        <Empty
          title={filter === "all" ? "还没有提交过歌词，对齐后觉得准可以在歌词区提交" : "这一类下面没有提交"}
          className="h-[40vh]"
        />
      ) : (
        <div className="flex flex-col gap-0.5 pb-4">
          {shown.map(item => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() =>
                usePlayList.getState().play({ type: "mv", bvid: item.bvid, cid: item.cid, title: item.title })
              }
              className="hover:bg-content2 flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-md px-2 py-2"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm font-medium" title={item.title}>
                  {item.title}
                </span>
                <span className="text-foreground-500 text-xs tabular-nums">
                  {item.lineCount} 行 · {formatShortDate(item.createdAt)} 提交
                </span>
                {item.status === "rejected" && item.reason ? (
                  <span className="text-danger text-xs">打回原因：{item.reason}</span>
                ) : null}
              </div>
              <Chip size="sm" radius="sm" variant="flat" color={STATUS[item.status].color} className="flex-none">
                {STATUS[item.status].label}
              </Chip>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default SubmissionsTab;
