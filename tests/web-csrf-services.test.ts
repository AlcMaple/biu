import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("@/service/request", () => ({
  apiRequest: { post: requestMocks.post },
}));

import { postGaiaVGateRegister, postGaiaVGateValidate } from "@/service/gaia-vgate";
import { postCollResourceDeal } from "@/service/medialist-gateway-coll-resource-deal";
import { postDynamicFeedThumb } from "@/service/web-dynamic-feed-thumb";

describe("Web state-changing service CSRF policy", () => {
  beforeEach(() => {
    requestMocks.post.mockResolvedValue({ code: 0 });
  });

  it("delegates dynamic likes and music collection writes to BFF CSRF injection", () => {
    const thumb = { dyn_id_str: "42", up: 1 };
    postDynamicFeedThumb(thumb);
    expect(requestMocks.post).toHaveBeenLastCalledWith("/x/dynamic/feed/dyn/thumb", thumb, {
      useCSRF: true,
    });

    const collection = { add_media_ids: "7", rid: 42, type: 12 };
    postCollResourceDeal(collection);
    expect(requestMocks.post).toHaveBeenLastCalledWith("/medialist/gateway/coll/resource/deal", collection, {
      useCSRF: true,
      useFormData: true,
    });
  });

  it("marks both Gaia writes for optional server-side CSRF injection", () => {
    const register = { v_voucher: "voucher" };
    postGaiaVGateRegister(register);
    expect(requestMocks.post).toHaveBeenLastCalledWith(
      "/x/gaia-vgate/v1/register",
      register,
      expect.objectContaining({ useFormData: true, useOptionalCSRF: true }),
    );

    const validate = {
      challenge: "challenge",
      seccode: "seccode",
      token: "token",
      validate: "validate",
    };
    postGaiaVGateValidate(validate);
    expect(requestMocks.post).toHaveBeenLastCalledWith(
      "/x/gaia-vgate/v1/validate",
      validate,
      expect.objectContaining({ useFormData: true, useOptionalCSRF: true }),
    );
  });
});
