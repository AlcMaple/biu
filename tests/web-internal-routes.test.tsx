import { isValidElement } from "react";
import { Navigate } from "react-router";

import { describe, expect, it } from "vitest";

import { createRoutes } from "@/routes";

const getRouteElement = (web: boolean, path: string) => {
  const element = createRoutes(web).find(route => route.path === path)?.element;
  if (!isValidElement<Record<string, unknown>>(element)) throw new Error(`路由 ${path} 缺少 React element`);
  return element;
};

describe("Web 内部窗口路由隔离", () => {
  it.each(["mini-player", "desktop-lyrics"])("Web 直达 %s 时返回首页", path => {
    const webElement = getRouteElement(true, path);
    const appElement = getRouteElement(false, path);

    expect(webElement.type).toBe(Navigate);
    expect(webElement.props).toMatchObject({ replace: true, to: "/" });
    expect(appElement.type).not.toBe(Navigate);
  });
});
