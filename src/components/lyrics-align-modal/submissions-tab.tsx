import { useCallback, useEffect, useState } from "react";

import { Alert, Button, Chip, Spinner } from "@heroui/react";

import { AlignApiError, getMySubmissions } from "@/service/lyrics-align";

const STATUS_TEXT: Record<
  AlignSubmissionStatus,
  { label: string; color: "warning" | "success" | "danger" | "default" }
> = {
  pending: { label: "待审核", color: "warning" },
  approved: { label: "已通过", color: "success" },
  rejected: { label: "被打回", color: "danger" },
  withdrawn: { label: "已撤回", color: "default" },
  superseded: { label: "已被新版本替换", color: "default" },
};

const formatDate = (ts: number) => new Date(ts).toLocaleString();

const SubmissionsTab = () => {
  const [items, setItems] = useState<AlignSubmissionBrief[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  if (!items.length) return <div className="text-foreground/60 py-8 text-center text-sm">还没有提交过歌词</div>;

  return (
    <div className="flex flex-col gap-2">
      {items.map(item => (
        <div key={item.id} className="border-default-200 rounded-medium border px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 truncate text-sm font-medium">{item.title}</div>
            <Chip size="sm" variant="flat" color={STATUS_TEXT[item.status].color}>
              {STATUS_TEXT[item.status].label}
            </Chip>
          </div>
          <div className="text-foreground/50 mt-1 text-xs">
            {item.bvid} · {item.lineCount} 行 · {formatDate(item.createdAt)}
          </div>
          {item.status === "rejected" && item.reason ? (
            <div className="text-danger mt-1 text-sm">打回原因：{item.reason}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
};

export default SubmissionsTab;
