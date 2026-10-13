import { Select, SelectItem } from "@heroui/react";

import { useIsMobileLayout } from "@/common/hooks/use-responsive";
import SearchButton from "@/components/search-button";

export interface SearchProps {
  onKeywordSearch?: (keyword: string) => void;
  orderOptions?: { key: string; label: string }[];
  order?: string;
  onOrderChange?: (order: string) => void;
}

const SearchWithSort = ({ onKeywordSearch, orderOptions, order, onOrderChange }: SearchProps) => {
  const isMobileLayout = useIsMobileLayout();
  const hasOrderOptions = Boolean(orderOptions?.length);

  return (
    <div className={isMobileLayout ? "flex min-w-0 flex-1 items-center gap-2" : "flex items-center space-x-2"}>
      <SearchButton onSearch={onKeywordSearch} className={isMobileLayout ? "min-w-0 flex-1" : undefined} />
      {hasOrderOptions && (
        <Select
          radius="md"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={order ? new Set([order]) : new Set<string>()}
          onSelectionChange={keys => {
            if (keys === "all") return;
            if (keys instanceof Set && keys.size === 0) return;
            const selectedValue = keys instanceof Set ? Array.from(keys)[0] : keys;
            onOrderChange?.(selectedValue as string);
          }}
          items={orderOptions}
          listboxProps={{
            color: "primary",
            hideSelectedIcon: true,
          }}
          aria-label="排序方式"
          className={isMobileLayout ? "order-first w-[112px] max-w-none flex-none" : "max-w-xs"}
          classNames={{
            innerWrapper: "w-20",
            popoverContent: isMobileLayout ? "min-w-[132px]" : undefined,
          }}
        >
          {item => (
            <SelectItem key={item.key} textValue={item.label}>
              {item.label}
            </SelectItem>
          )}
        </Select>
      )}
    </div>
  );
};

export default SearchWithSort;
