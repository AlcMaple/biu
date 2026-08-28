import { describe, expect, it, vi } from "vitest";

import { offlineDemoResponse } from "@/common/offline-demo-fixtures";

describe("offline demo fixtures", () => {
  it("returns the same service envelope used by recommendation pages", () => {
    const response = offlineDemoResponse({
      url: "/x/web-interface/region/feed/rcmd",
      baseURL: "/__biu_proxy/bilibili/api",
      method: "get",
    });

    expect(response).toMatchObject({ code: 0, data: { archives: expect.any(Array) } });
  });

  it("is used by the axios service layer", async () => {
    vi.stubEnv("BIU_OFFLINE_DEMO", "true");
    const { apiRequest } = await import("@/service/request");
    const response = await apiRequest.get("/x/web-interface/region/feed/rcmd");
    expect(response).toMatchObject({ code: 0, data: { archives: expect.any(Array) } });
  });
});
