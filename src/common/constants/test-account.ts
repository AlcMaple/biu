import type { UserInfo } from "@/service/user-info";

// 只在非生产构建里提供入口；mid 取 B 站不会分配的 0 之外的小号段，避免撞上真实账号
export const TEST_ACCOUNT_MID = 1;

export const isTestAccountEnabled = import.meta.env.MODE !== "production";

export const isTestAccount = (user: Pick<UserInfo, "mid"> | null | undefined) => user?.mid === TEST_ACCOUNT_MID;

export const createTestUser = () =>
  ({
    isLogin: true,
    mid: TEST_ACCOUNT_MID,
    uname: "测试账号",
    face: "",
    vipStatus: 0,
    vipType: 0,
    level_info: { current_level: 1 },
  }) as UserInfo;
