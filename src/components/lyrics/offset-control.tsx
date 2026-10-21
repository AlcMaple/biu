import { Slider } from "@heroui/react";

interface OffsetControlProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
}

const formatLabel = (ms: number) => (ms >= 0 ? `+${ms}` : `${ms}`);

const OffsetControl = ({ value, min = -5000, max = 5000, onChange }: OffsetControlProps) => (
  <div className="flex flex-col gap-1 px-3 py-2">
    <div className="flex items-center justify-between text-sm">
      <span>歌词快慢</span>
      <span className="text-foreground-500 text-xs">{formatLabel(value)} ms</span>
    </div>
    <Slider
      aria-label="调整歌词快慢"
      minValue={min}
      maxValue={max}
      step={50}
      value={value}
      onChange={v => onChange(v as number)}
      size="sm"
      color="primary"
      classNames={{ thumb: "after:hidden" }}
    />
    <div className="text-foreground-500 flex justify-between text-xs">
      <span>歌词提前</span>
      <span>歌词延后</span>
    </div>
  </div>
);

export default OffsetControl;
