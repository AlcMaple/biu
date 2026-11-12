import { expect, test, vi } from "vitest";

import { getDashUrl } from "@/common/utils/audio";
import { getPlayerPlayurl } from "@/service/player-playurl";
import { isMediaSafetyError } from "@shared/media-safety-error";

vi.mock("@/service/player-playurl", () => ({ getPlayerPlayurl: vi.fn() }));

test("明确暂停保持错误身份，不变成空音频结果", async () => {
  const error = Object.assign(new Error("fixture"), { response: { status: 423, data: { code: "BIU_MEDIA_PAUSED" } } });
  vi.mocked(getPlayerPlayurl).mockRejectedValueOnce(error);
  await expect(getDashUrl("BVfixture", 1)).rejects.toBe(error);
});
test("普通失败保留原空结果行为", async () => {
  vi.mocked(getPlayerPlayurl).mockRejectedValueOnce(new Error("fixture network"));
  await expect(getDashUrl("BVfixture", 1)).resolves.toEqual({ isLossless: false });
});
test.each([
  null,
  {},
  new Error("423"),
  { response: { status: 423, data: { code: "OTHER_LOCK" } } },
  { response: { status: 403, data: { code: "BIU_MEDIA_PAUSED" } } },
])("不按错误文案或任意423猜暂停 %j", input => {
  expect(isMediaSafetyError(input)).toBe(false);
});
