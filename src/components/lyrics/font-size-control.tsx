import { Slider } from "@heroui/react";

interface FontSizeControlProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
}

const FontSizeControl = ({ value, min = 12, max = 48, onChange }: FontSizeControlProps) => (
  <div className="flex flex-col gap-1 px-3 py-2">
    <div className="flex items-center justify-between text-sm">
      <span>字号</span>
      <span className="text-foreground-500 text-xs">{Math.round(value)}px</span>
    </div>
    <Slider
      aria-label="调整字号"
      minValue={min}
      maxValue={max}
      step={1}
      value={value}
      onChange={v => onChange(v as number)}
      size="sm"
      color="primary"
      classNames={{ thumb: "after:hidden" }}
    />
    <div className="text-foreground-500 flex justify-between text-xs">
      <span>小</span>
      <span>大</span>
    </div>
  </div>
);

export default FontSizeControl;
