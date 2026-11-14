import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { describe, expect, it } from "vitest";

const { apiRequest } = await import("@/service/request");

function failWith(status: number | null, code?: string) {
  apiRequest.defaults.adapter = async config => {
    const response =
      status === null ? undefined : ({ status, data: "", headers: {}, config, statusText: "" } as AxiosResponse);
    throw new AxiosError("raw", code, config as InternalAxiosRequestConfig, undefined, response);
  };
}

async function messageOf() {
  try {
    await apiRequest.get("/x/v3/fav/resource/list");
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("请求本应失败");
}

describe("接口出错时给用户看的提示", () => {
  it.each([
    [502, "服务器暂时连不上 B 站（502），请稍后再试"],
    [429, "请求太频繁，被 B 站暂时限流（429），请过几分钟再试"],
    [412, "被 B 站风控拦截（412），请过一会儿再试"],
    [500, "B 站服务暂时出错（500），请稍后再试"],
  ])("%i 不再显示英文原文", async (status, text) => {
    failWith(status);
    expect(await messageOf()).toBe(text);
  });

  it("断网时说连不上，而不是英文原文", async () => {
    failWith(null, "ERR_NETWORK");
    expect(await messageOf()).toBe("连不上服务器，请检查网络");
  });
});
