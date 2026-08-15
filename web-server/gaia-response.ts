import { type ApiResponseTransformer } from "./api-proxy.js";

const GAIA_VALIDATE_PATH = "/x/gaia-vgate/v1/validate";
const MAX_GAIA_RESPONSE_BYTES = 256 * 1024;
const GAIA_TOKEN_PATTERN = /^[0-9A-Za-z._~-]{8,512}$/;

interface GaiaValidatePayload {
  code?: unknown;
  data?: {
    grisk_id?: unknown;
    is_valid?: unknown;
  };
}

export function createGaiaApiResponseTransformer(): ApiResponseTransformer {
  return {
    matches: target => target.pathname === GAIA_VALIDATE_PATH,
    maxBytes: MAX_GAIA_RESPONSE_BYTES,
    async transform(body, { session, status, target }) {
      if (!session || status < 200 || status >= 300) return body;

      let payload: GaiaValidatePayload;
      try {
        payload = JSON.parse(body.toString("utf8")) as GaiaValidatePayload;
      } catch {
        return body;
      }

      const token = payload.data?.grisk_id;
      if (payload.code !== 0 || payload.data?.is_valid !== 1 || typeof token !== "string") return body;
      if (!GAIA_TOKEN_PATTERN.test(token)) return body;

      await session.updateFromSetCookie(
        [`x-bili-gaia-vtoken=${token}; Domain=.bilibili.com; Path=/; Secure; HttpOnly; SameSite=None`],
        target,
      );
      return body;
    },
  };
}
