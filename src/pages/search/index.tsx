import React, { useEffect, useRef, useState } from "react";

import { Tabs, Tab } from "@heroui/react";

import Empty from "@/components/empty";
import ScrollContainer, { type ScrollRefObject } from "@/components/scroll-container";
import { useSearchHistory } from "@/store/search-history";
import { useUser } from "@/store/user";

import { getSearchTypeOptions, SearchType } from "./search-type";
import UserList from "./user-list";
import VideoList from "./video-list";

const Search = () => {
  const scrollerRef = useRef<ScrollRefObject>(null);
  const [searchType, setSearchType] = useState(SearchType.Video);
  const keyword = useSearchHistory(s => s.keyword);
  const searchRevision = useSearchHistory(s => s.searchRevision);
  const isLoggedIn = useUser(s => Boolean(s.user?.isLogin && s.user.mid));
  const searchTypeOptions = getSearchTypeOptions(isLoggedIn);

  useEffect(() => {
    if (!isLoggedIn && searchType === SearchType.User) setSearchType(SearchType.Video);
  }, [isLoggedIn, searchType]);

  if (!keyword) {
    return <Empty />;
  }

  return (
    <ScrollContainer enableBackToTop ref={scrollerRef} className="h-full w-full">
      <div className="px-4">
        <h1>搜索【{keyword}】的结果</h1>
        <div className="flex items-center justify-between py-4">
          <Tabs
            variant="solid"
            radius="md"
            classNames={{
              cursor: "rounded-medium",
            }}
            className="-ml-1"
            items={searchTypeOptions}
            selectedKey={searchType}
            onSelectionChange={v => {
              setSearchType(v as SearchType);
            }}
          >
            {item => <Tab key={item.value} title={item.label} />}
          </Tabs>
        </div>
      </div>
      <>
        {/* 关键词不变时也要重新挂载结果组件，才能再次请求。 */}
        {searchType === SearchType.Video && (
          <VideoList
            key={`video-${searchRevision}`}
            keyword={keyword}
            getScrollElement={() => scrollerRef.current?.osInstance()?.elements().viewport || null}
          />
        )}
        {isLoggedIn && searchType === SearchType.User && (
          <UserList
            key={`user-${searchRevision}`}
            keyword={keyword}
            getScrollElement={() => scrollerRef.current?.osInstance()?.elements().viewport || null}
          />
        )}
      </>
    </ScrollContainer>
  );
};

export default Search;
