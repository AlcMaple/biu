import { beforeEach, describe, expect, it, vi } from "vitest";

const { postClick, postHeartbeat, settingsState, userState } = vi.hoisted(() => ({
  postClick: vi.fn(),
  postHeartbeat: vi.fn(),
  settingsState: { reportPlayHistory: true },
  userState: {} as { user?: { level_info?: { current_level?: number }; mid?: number } },
}));

vi.mock("@/platform/detect", () => ({ isWeb: true }));
vi.mock("@/platform", () => ({ log: { warn: vi.fn() } }));
vi.mock("@/service/click-interface-click-web-h5", () => ({
  postClickInterfaceClickWebH5: postClick,
}));
vi.mock("@/service/click-interface-web-heartbeat", () => ({
  postClickInterfaceWebHeartbeat: postHeartbeat,
}));
vi.mock("@/store/settings", () => ({ useSettings: { getState: () => settingsState } }));
vi.mock("@/store/user", () => ({ useUser: { getState: () => userState } }));

import { beginPlayReport, endPlayReport, reportHeartbeat } from "@/common/utils/play-report";

const item = { aid: 42, bvid: "BV1test", cid: 7, id: "play-1", type: "mv" as const };

describe("Web play history reporting", () => {
  beforeEach(() => {
    delete userState.user;
    settingsState.reportPlayHistory = true;
    endPlayReport();
  });

  it("does not send click or heartbeat requests for anonymous Web playback", async () => {
    await beginPlayReport(item);
    await reportHeartbeat(item, 10, 100, 1);

    expect(postClick).not.toHaveBeenCalled();
    expect(postHeartbeat).not.toHaveBeenCalled();
  });

  it("keeps play reporting enabled for signed-in Web users", async () => {
    userState.user = { level_info: { current_level: 6 }, mid: 123 };
    postClick.mockResolvedValue(undefined);
    postHeartbeat.mockResolvedValue(undefined);

    await beginPlayReport(item);
    await reportHeartbeat(item, 10, 100, 1);

    expect(postClick).toHaveBeenCalledTimes(1);
    expect(postHeartbeat).toHaveBeenCalledTimes(1);
  });
});
