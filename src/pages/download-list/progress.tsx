import { Progress } from "@heroui/react";
import { RiCheckboxCircleLine } from "@remixicon/react";

interface Props {
  data: MediaDownloadTask;
}

interface PhaseBarProps {
  label: string;
  value: number;
  isActive: boolean;
  isFailed?: boolean;
}

const PhaseBar = ({ label, value, isActive, isFailed }: PhaseBarProps) => (
  <div className="flex items-center space-x-2">
    <span className="text-default-500 w-10 shrink-0 text-xs">{label}</span>
    <Progress
      aria-label={label}
      value={value}
      maxValue={100}
      showValueLabel={false}
      size="sm"
      radius="md"
      className="flex-1"
      classNames={{
        indicator: isFailed && isActive ? "bg-danger" : "bg-blue-500",
      }}
    />
    <span className="w-8 shrink-0 text-right text-xs">{value}%</span>
  </div>
);

const StageProgress = ({ data }: Props) => {
  if (data.status === "waiting") {
    return <span className="text-xs">等待下载...</span>;
  }

  if (data.status === "completed") {
    return (
      <div className="text-success flex items-center justify-center space-x-1">
        <RiCheckboxCircleLine size={16} />
        <span>下载完成</span>
      </div>
    );
  }

  const { status, downloadProgress, mergeProgress, convertProgress } = data;

  const showMergeBar =
    ["merging", "mergePaused", "converting", "convertPaused"].includes(status) || (mergeProgress ?? 0) > 0;

  const showConvertBar = ["converting", "convertPaused"].includes(status) || (convertProgress ?? 0) > 0;

  const downloadValue = showMergeBar ? 100 : (downloadProgress ?? 0);
  const mergeValue = showConvertBar ? 100 : (mergeProgress ?? 0);
  const convertValue = convertProgress ?? 0;

  const isDownloadActive = !showMergeBar;
  const isMergeActive = showMergeBar && !showConvertBar;
  const isFailed = status === "failed";

  return (
    <div className="flex h-full flex-col justify-center space-y-1.5">
      <PhaseBar label="下载" value={downloadValue} isActive={isDownloadActive} isFailed={isFailed} />
      {showMergeBar && <PhaseBar label="合并" value={mergeValue} isActive={isMergeActive} isFailed={isFailed} />}
      {showConvertBar && <PhaseBar label="转换" value={convertValue} isActive={true} isFailed={isFailed} />}
      {isFailed && data.error && (
        <p title={data.error} className="text-danger line-clamp-2 text-xs break-all">
          {data.error}
        </p>
      )}
    </div>
  );
};

export default StageProgress;
