import { useEffect, useMemo, useState } from "react";

import { Spinner, Tab, Tabs } from "@heroui/react";

import { isTestAccount } from "@/common/constants/test-account";
import Empty from "@/components/empty";
import ScrollContainer from "@/components/scroll-container";
import { rankingItems, syncPlayRanking, usePlayRankingState } from "@/store/play-ranking";
import { useUser } from "@/store/user";

import PlayRankingItemRow from "./item";
import { buildMockRecords, MOCK_ERROR, MOCK_SCENARIOS, type MockScenario } from "./mock";

type Period = "week" | "all";

const PlayRanking = () => {
  const [period, setPeriod] = useState<Period>("week");
  const mid = useUser(state => (state.user?.mid ? String(state.user.mid) : null));
  const testAccount = useUser(state => isTestAccount(state.user));
  const [scenario, setScenario] = useState<MockScenario>("data");
  const mockRecords = useMemo(() => buildMockRecords(), []);
  const state = usePlayRankingState();
  const sameAccount = state.mid === mid;
  const records = testAccount ? (scenario === "data" ? mockRecords : {}) : sameAccount ? state.records : {};
  const list = rankingItems(records, period);
  const loading = testAccount ? scenario === "loading" : state.loading || !sameAccount;
  const error = testAccount ? (scenario === "error" ? MOCK_ERROR : undefined) : sameAccount ? state.error : undefined;

  useEffect(() => {
    void syncPlayRanking(undefined, true);
  }, [mid]);

  return (
    <ScrollContainer pageScroll enableBackToTop className="h-full w-full px-4">
      <div className="mb-2">
        <h1>我的听歌排行</h1>
        {testAccount && (
          <Tabs
            aria-label="测试数据场景"
            selectedKey={scenario}
            onSelectionChange={key => setScenario(key as MockScenario)}
            size="sm"
            color="primary"
            variant="bordered"
            className="mt-2"
          >
            {MOCK_SCENARIOS.map(item => (
              <Tab key={item.key} title={item.title} />
            ))}
          </Tabs>
        )}
        {error && (
          <p role="alert" className="text-danger mt-2 text-sm">
            {error}
          </p>
        )}
        <Tabs selectedKey={period} onSelectionChange={key => setPeriod(key as Period)} size="sm" className="mt-2">
          <Tab key="week" title="最近一周" />
          <Tab key="all" title="所有时间" />
        </Tabs>
      </div>

      {loading && list.length === 0 && (
        <div className="flex h-[40vh] items-center justify-center">
          <Spinner size="lg" label="统计中..." />
        </div>
      )}

      {!loading && list.length === 0 && <Empty title="暂无听歌记录" className="h-[40vh]" />}

      {list.length > 0 && (
        <div className="flex flex-col gap-0.5 pb-4">
          {list.map((item, index) => (
            <PlayRankingItemRow key={item.key} rank={index + 1} item={item} />
          ))}
        </div>
      )}
    </ScrollContainer>
  );
};

export default PlayRanking;
