import { useEffect, useState } from "react";

import { Button } from "@heroui/react";

import { isStaticDemo } from "@/common/offline-demo";
import { refreshSyncSafety, resumeSyncSafety, useSyncSafetyView } from "@/service/sync/safety";

export default function SyncSafetyNotice() {
  const view = useSyncSafetyView();
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (isStaticDemo) return;
    const refresh = () => {
      void refreshSyncSafety().catch(error =>
        console.warn("[sync/safety]", error instanceof Error ? error.message : "暂停记录读取失败"),
      );
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  if (isStaticDemo) return null;
  const hold = view.state?.hold;
  if (!view.error && !hold && !view.abandonedIds.length) return null;
  const message =
    view.error ??
    (hold?.reason === "rate_limit"
      ? "同步请求过多，自动同步已暂停"
      : hold?.reason === "risk_control"
        ? "同步请求被限制，自动同步已暂停"
        : hold
          ? "同步服务暂不可用，自动同步已暂停"
          : "上次同步结果未确认，自动同步已暂停");
  return (
    <div
      role="alert"
      className="bg-warning-50 text-warning-800 mx-4 mb-2 flex flex-none flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm"
    >
      <span className="min-w-0 flex-1">{changed ? "暂停状态已变化，请重新确认" : message}</span>
      <Button
        size="sm"
        variant="flat"
        color="warning"
        isLoading={busy}
        onPress={async () => {
          setBusy(true);
          setChanged(false);
          try {
            if (view.state === undefined) {
              await refreshSyncSafety();
              return;
            }
            setChanged(!(await resumeSyncSafety(view.state.revision)));
          } catch (error) {
            console.warn("[sync/safety]", error instanceof Error ? error.message : "恢复失败");
          } finally {
            setBusy(false);
          }
        }}
      >
        {view.state === undefined ? "检查本机记录" : "确认恢复同步"}
      </Button>
    </div>
  );
}
