import React, { useState } from "react";

import { Input } from "@heroui/react";
import { RiSearchLine } from "@remixicon/react";
import { useDebounceFn } from "ahooks";

interface Props {
  onSearch?: (value: string) => void;
}

/** 列表搜索框（常驻显示，输入防抖触发搜索） */
const SearchButton = ({ onSearch }: Props) => {
  const [value, setValue] = useState("");

  const { run: handleSearch } = useDebounceFn(
    (val: string) => {
      onSearch?.(val);
    },
    { wait: 500 },
  );

  return (
    <Input
      isClearable
      radius="md"
      value={value}
      onValueChange={val => {
        setValue(val);
        handleSearch(val);
      }}
      onClear={() => {
        handleSearch("");
      }}
      onKeyDown={e => {
        if (e.key === "Enter" && value?.trim()) {
          handleSearch(value);
        }
      }}
      placeholder="搜索"
      startContent={<RiSearchLine size={18} className="text-default-400" />}
      className="w-60"
      classNames={{
        inputWrapper: "h-10 pr-1",
      }}
    />
  );
};

export default SearchButton;
