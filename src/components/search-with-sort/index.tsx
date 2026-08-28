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
    <div
      className={
        isMobileLayout
          ? hasOrderOptions
            ? "flex min-w-0 flex-1 flex-col items-stretch gap-2"
            : "flex min-w-0 flex-1 items-center"
          : "flex items-center space-x-2"
      }
    >
      <SearchButton onSearch={onKeywordSearch} className={isMobileLayout ? "w-full min-w-0" : undefined} />
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
          className={isMobileLayout ? "w-full max-w-none min-w-0" : "max-w-xs"}
          classNames={{
            innerWrapper: "w-20",
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
