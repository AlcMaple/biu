import { trackLines } from "./report-scope";

interface Props {
  report: Pick<AlignReport, "track" | "corrected">;
  alignment: LyricsAlignment | null;
}

// 用户改后的歌词和对齐结果里同一轨逐行对照，只列出有差别的行（行数不同时多出来的行也算）
const CorrectionDiff = ({ report, alignment }: Props) => {
  if (!report.corrected) return null;
  if (!alignment) return <div className="text-foreground-500 text-xs">被报的对齐结果已不在服务器上，没法对照</div>;
  const before = trackLines(alignment.lines, report.track ?? "original");
  const after = report.corrected.split("\n");
  const rows = Array.from({ length: Math.max(before.length, after.length) }, (_, i) => ({
    line: i + 1,
    before: before[i] ?? "",
    after: after[i] ?? "",
  })).filter(row => row.before.trimEnd() !== row.after.trimEnd());

  return (
    <div className="border-default-200 flex flex-col gap-1 rounded-md border p-3 text-xs">
      <div className="text-foreground-500">用户改了 {rows.length} 行</div>
      {rows.map(row => (
        <div key={row.line} className="grid grid-cols-[2rem_1fr_1fr] gap-2">
          <span className="text-foreground-400 tabular-nums">{row.line}</span>
          <span className="bg-danger/10 text-danger rounded px-1 whitespace-pre-wrap">{row.before || "（空）"}</span>
          <span className="bg-success/10 text-success rounded px-1 whitespace-pre-wrap">{row.after || "（空）"}</span>
        </div>
      ))}
    </div>
  );
};

export default CorrectionDiff;
