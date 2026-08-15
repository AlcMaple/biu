import { Navigate } from "react-router";

import { getDefaultMenuList } from "@/common/constants/menus";
import { createRoutes } from "@/routes";

const getMainRoute = (web: boolean) => {
  const mainRoute = createRoutes(web).find(route => route.path === "/");
  if (!mainRoute) throw new Error("主路由不存在");
  return mainRoute;
};

describe("Web 本地音乐隔离", () => {
  it("只从 Web 默认菜单移除本地音乐", () => {
    expect(getDefaultMenuList(true).some(item => item.href === "/local-music")).toBe(false);
    expect(getDefaultMenuList(false).some(item => item.href === "/local-music")).toBe(true);
    expect(getDefaultMenuList(true).some(item => item.href === "/local-collection/:id")).toBe(false);
  });

  it("Web 直达本地音乐时返回首页", () => {
    const webRoute = getMainRoute(true).children?.find(route => route.path === "local-music");
    const appRoute = getMainRoute(false).children?.find(route => route.path === "local-music");

    expect(webRoute?.element?.type).toBe(Navigate);
    expect(webRoute?.element?.props).toMatchObject({ replace: true, to: "/" });
    expect(appRoute?.element?.type).not.toBe(Navigate);
  });

  it("Web 仍保留本地歌单路由", () => {
    const localCollectionRoute = getMainRoute(true).children?.find(route => route.path === "local-collection/:id");
    expect(localCollectionRoute).toBeDefined();
    expect(localCollectionRoute?.element?.type).not.toBe(Navigate);
  });
});
