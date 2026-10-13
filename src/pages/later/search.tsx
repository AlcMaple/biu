import { useState } from "react";

import { Input } from "@heroui/react";
import { RiSearchLine } from "@remixicon/react";
import { useDebounceFn } from "ahooks";

import { useIsMobileLayout } from "@/common/hooks/use-responsive";
import DateRangePicker from "@/components/date-range-picker";

interface Props {
  onSearch?: (keyword: string) => void;
  onDateRangeChange?: (range: { start?: number; end?: number } | null) => void;
}

const Search = ({ onSearch, onDateRangeChange }: Props) => {
  const isMobileLayout = useIsMobileLayout();
  const [keyword, setKeyword] = useState("");

  const { run: handleSearch } = useDebounceFn(
    (val: string) => {
      onSearch?.(val);
    },
    { wait: 500 },
  );

  const input = (
    <Input
      placeholder="搜索标题/UP主名称"
      startContent={<RiSearchLine size={16} />}
      value={keyword}
      onValueChange={setKeyword}
      onKeyDown={e => e.key === "Enter" && handleSearch(keyword)}
      isClearable
      onClear={() => {
        handleSearch("");
      }}
      radius="md"
      className={isMobileLayout ? "min-w-0 flex-1" : "w-64"}
      classNames={{ inputWrapper: "h-10" }}
    />
  );

  if (isMobileLayout) {
    return (
      <div className="w-full py-2">
        <DateRangePicker onDateRangeChange={onDateRangeChange}>{input}</DateRangePicker>
      </div>
    );
  }

  return (
    <div className="flex w-full items-center justify-between space-x-2 py-2">
      <DateRangePicker onDateRangeChange={onDateRangeChange} />
      {input}
    </div>
  );
};

export default Search;
