import { useEffect, useState } from "react";

import { Accordion, AccordionItem, Button, Chip, addToast } from "@heroui/react";

import {
  canPromptPwaInstall,
  isRunningStandalone,
  promptPwaInstall,
  subscribePwaInstall,
} from "@/common/utils/pwa-install";

interface BrandGuide {
  key: string;
  title: string;
  steps: string[];
}

/**
 * 各厂商入口名称不同、系统版本间也有出入，这里只写「去哪找」的大方向，用户按关键词在设置里搜索即可。
 */
const BRAND_GUIDES: BrandGuide[] = [
  {
    key: "game",
    title: "游戏手机（红魔 / ROG / 黑鲨 / 拯救者等）",
    steps: [
      "打开系统自带的「游戏空间 / 性能模式 / 内存管理」，把浏览器（或已安装的 Biu）加入白名单或「不清理」列表。",
      "在最近任务里把浏览器卡片「锁定」（下拉或长按卡片，选择锁定 / 加锁）。",
      "关闭「自动清理后台 / 一键加速时清理」之类的选项，或把 Biu 所用的浏览器从清理名单中移除。",
    ],
  },
  {
    key: "xiaomi",
    title: "小米 / 红米 / POCO（HyperOS / MIUI）",
    steps: [
      "设置 → 应用设置 → 应用管理 → 选择浏览器（或 Biu）→ 省电策略 → 选「无限制」。",
      "同一页面打开「自启动」。",
      "最近任务里下拉浏览器卡片，点锁形图标锁定。",
    ],
  },
  {
    key: "huawei",
    title: "华为 / 荣耀（HarmonyOS / MagicOS）",
    steps: [
      "设置 → 电池 → 启动管理 → 找到浏览器（或 Biu）→ 关闭「自动管理」，手动打开「允许后台活动」。",
      "最近任务里下拉卡片锁定，防止一键清理时被清掉。",
    ],
  },
  {
    key: "oppo",
    title: "OPPO / 一加 / realme（ColorOS）",
    steps: [
      "设置 → 电池 → 应用耗电管理（或在应用信息 → 耗电管理）→ 浏览器（或 Biu）→ 允许后台运行 / 允许自启动。",
      "最近任务里下拉卡片，点锁形图标锁定。",
    ],
  },
  {
    key: "vivo",
    title: "vivo / iQOO（OriginOS / Funtouch）",
    steps: [
      "设置 → 电池 → 后台高耗电 → 允许浏览器（或 Biu）高耗电后台运行。",
      "设置 → 应用与权限 → 权限管理 → 自启动 → 允许浏览器（或 Biu）。",
      "最近任务里下拉卡片锁定。",
    ],
  },
  {
    key: "samsung",
    title: "三星（One UI）/ 其他 Android",
    steps: [
      "设置 → 应用 → 浏览器（或 Biu）→ 电池 → 选「不受限制」。",
      "设置 → 电池 → 后台使用限制 → 把浏览器从「休眠应用 / 深度休眠应用」中移除。",
      "其他品牌：在设置里搜索「电池优化」「自启动」「后台运行」「应用锁定」，对浏览器（或 Biu）逐项放开。",
    ],
  },
];

const BackgroundPlayGuide = () => {
  const [canInstall, setCanInstall] = useState(canPromptPwaInstall());
  const standalone = isRunningStandalone();

  useEffect(() => subscribePwaInstall(() => setCanInstall(canPromptPwaInstall())), []);

  const handleInstall = async () => {
    const accepted = await promptPwaInstall();
    if (accepted) addToast({ title: "已添加到主屏幕", color: "success" });
  };

  return (
    <div className="space-y-5 py-2">
      <section className="space-y-2">
        <h3 className="text-medium font-semibold">为什么切到后台就停了？</h3>
        <p className="text-small text-default-500">
          部分手机（尤其是游戏手机）的系统会在你切走后自动清理后台，浏览器也会被一起清掉，音乐就停了。这是手机系统的策略，网页本身没法绕过，需要你在手机里给它放行一次。
        </p>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-medium font-semibold">第一步：安装到主屏幕（推荐）</h3>
          {standalone && (
            <Chip size="sm" color="success" variant="flat">
              已是独立应用
            </Chip>
          )}
        </div>
        <p className="text-small text-default-500">
          安装后 Biu 会像普通 App
          一样独立运行，有自己的图标和媒体通知，系统对它比对网页标签页更宽容，也方便你单独给它设置白名单。
        </p>
        {!standalone &&
          (canInstall ? (
            <Button color="primary" onPress={handleInstall}>
              安装到主屏幕
            </Button>
          ) : (
            <p className="text-small text-default-500">
              没有看到安装按钮？用 Chrome 打开本页，点右上角菜单「⋮」→「安装应用 / 添加到主屏幕」即可。
            </p>
          ))}
      </section>

      <section className="space-y-2">
        <h3 className="text-medium font-semibold">第二步：让手机不要清理它</h3>
        <p className="text-small text-default-500">
          选择你的手机品牌，按步骤放行。已安装 Biu
          的话，下面的「浏览器」请换成「Biu」。菜单名称可能随系统版本略有不同，找不到时在设置里搜索关键词即可。
        </p>
        <Accordion variant="bordered" selectionMode="multiple" isCompact>
          {BRAND_GUIDES.map(guide => (
            <AccordionItem key={guide.key} aria-label={guide.title} title={guide.title}>
              <ol className="text-small text-default-600 list-decimal space-y-1.5 pb-2 pl-5">
                {guide.steps.map(step => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      <section className="space-y-1">
        <h3 className="text-medium font-semibold">还是会停？</h3>
        <p className="text-small text-default-500">
          播放时请保持通知栏的媒体控制开启。即便被清理，重新打开 Biu 也会停在上次的位置，点一下播放即可继续。
        </p>
      </section>
    </div>
  );
};

export default BackgroundPlayGuide;
