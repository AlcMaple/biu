import { memo, useState, type MouseEvent, type ReactNode } from "react";

import {
  Button,
  DateRangePicker as HeroDateRangePicker,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RangeCalendar,
  Tab,
  Tabs,
  type DateValue,
  type RangeValue,
} from "@heroui/react";
import { getLocalTimeZone } from "@internationalized/date";
import { RiCalendarLine } from "@remixicon/react";
import moment from "moment";

import { useIsMobileLayout } from "@/common/hooks/use-responsive";

interface Props {
  onDateRangeChange?: (range: { start?: number; end?: number } | null) => void;
  /** 手机形态下与日期按钮同一行、占满剩余宽度的内容（通常是搜索框） */
  children?: ReactNode;
}

// 默认样式下范围内的日期被主色整块填满、数字看不见：范围内只铺淡底，起止日才用实心主色并保证对比度
const calendarClassNames = {
  cellButton: [
    "data-[selected=true]:bg-primary/20 data-[selected=true]:text-foreground",
    "data-[selection-start=true]:bg-primary data-[selection-start=true]:text-white dark:data-[selection-start=true]:text-black",
    "data-[selection-end=true]:bg-primary data-[selection-end=true]:text-white dark:data-[selection-end=true]:text-black",
  ],
};

// 内联对象每次渲染都是新引用，父级（列表加载、搜索）一重渲染日历就被重新初始化，表现为整块闪烁，所以提到模块级
const desktopCalendarProps = { classNames: calendarClassNames };

const formatDay = (value: DateValue) => `${value.month}/${value.day}`;

const DateRangePicker = memo(({ onDateRangeChange, children }: Props) => {
  const isMobileLayout = useIsMobileLayout();
  const [selectedKey, setSelectedKey] = useState<string>("all");
  const [isCalendarOpen, setCalendarOpen] = useState(false);
  const [isPickerOpen, setPickerOpen] = useState(false);
  const [dateRange, setDateRange] = useState<RangeValue<DateValue> | null>(null);

  const handlePresetChange = (key: string) => {
    setSelectedKey(key);
    setDateRange(null); // Clear manual picker when preset is selected

    let start: number | undefined;
    let end: number | undefined;

    switch (key) {
      case "all":
        start = undefined;
        end = undefined;
        break;
      case "today":
        start = moment().startOf("day").valueOf();
        end = moment().endOf("day").valueOf();
        break;
      case "yesterday":
        start = moment().subtract(1, "days").startOf("day").valueOf();
        end = moment().subtract(1, "days").endOf("day").valueOf();
        break;
      case "week":
        start = moment().subtract(7, "days").startOf("day").valueOf();
        end = moment().endOf("day").valueOf();
        break;
    }

    onDateRangeChange?.(key === "all" ? null : { start, end });
  };

  // 点输入框任何位置（含年月日分段）都展开日历；弹层经 Portal 挂在 body，但 React 事件仍会冒泡到这里，
  // 所以只响应落在输入框自身 DOM 内的点击，已展开时交给原生触发按钮去收起，避免关了又被打开。
  const handleFieldClick = (event: MouseEvent<HTMLDivElement>) => {
    if (isPickerOpen || !(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    setPickerOpen(true);
  };

  const handleDateRangeChange = (value: RangeValue<DateValue> | null) => {
    setDateRange(value);
    setSelectedKey(""); // Clear preset selection when manual picker is used

    if (value && value.start && value.end) {
      const start = value.start.toDate(getLocalTimeZone()).getTime();
      const end = value.end.toDate(getLocalTimeZone()).getTime();
      onDateRangeChange?.({ start, end });
    } else {
      onDateRangeChange?.(null);
    }
  };

  return (
    <div
      className={
        isMobileLayout ? "flex w-full min-w-0 flex-col items-stretch gap-2" : "-ml-1 flex items-center space-x-4"
      }
    >
      <div className={isMobileLayout ? "-mx-1 min-w-0 overflow-x-auto" : undefined}>
        <Tabs
          aria-label="时间范围"
          variant="light"
          selectedKey={selectedKey}
          onSelectionChange={key => handlePresetChange(key as string)}
          classNames={{
            cursor: "rounded-medium",
            tabList: isMobileLayout ? "w-max min-w-full" : undefined,
          }}
          size={isMobileLayout ? "sm" : "md"}
        >
          <Tab key="all" title="全部时间" />
          <Tab key="today" title="今天" />
          <Tab key="yesterday" title="昨天" />
          <Tab key="week" title="近一周" />
        </Tabs>
      </div>

      {isMobileLayout ? (
        <div className="flex min-w-0 items-center gap-2">
          <Popover isOpen={isCalendarOpen} onOpenChange={setCalendarOpen} placement="bottom-start">
            <PopoverTrigger>
              <Button
                variant="flat"
                radius="md"
                color={dateRange ? "primary" : "default"}
                startContent={<RiCalendarLine size={18} />}
                aria-label="选择日期范围"
                className="h-10 min-w-0 flex-none px-3"
              >
                {dateRange ? `${formatDay(dateRange.start)} – ${formatDay(dateRange.end)}` : "日期"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0">
              <RangeCalendar
                aria-label="选择日期范围"
                visibleMonths={1}
                classNames={calendarClassNames}
                value={dateRange}
                onChange={value => {
                  handleDateRangeChange(value);
                  setCalendarOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
          {children}
        </div>
      ) : (
        <div className="w-64" onClick={handleFieldClick}>
          <HeroDateRangePicker
            isOpen={isPickerOpen}
            onOpenChange={setPickerOpen}
            aria-label="选择日期范围"
            // @ts-ignore 忽略类型检查，因为 HeroDateRangePicker 的类型定义有问题
            value={dateRange}
            onChange={handleDateRangeChange}
            visibleMonths={2}
            calendarProps={desktopCalendarProps}
          />
        </div>
      )}
    </div>
  );
});

DateRangePicker.displayName = "DateRangePicker";

export default DateRangePicker;
