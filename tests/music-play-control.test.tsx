import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const playback = vi.hoisted(() => ({
  prev: vi.fn(),
  next: vi.fn(),
  togglePlay: vi.fn(),
  list: [{ bvid: "test-song" }],
  isPlaying: false,
}));

vi.mock("@/store/play-list", () => {
  const selectPlayback = (select: (state: typeof playback) => unknown) => select(playback);
  return { usePlayList: selectPlayback };
});
vi.mock("@/platform", () => ({ isWeb: true }));

import MusicPlayControl from "@/components/music-play-control";

describe("播放器键盘可访问名称", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    playback.list = [{ bvid: "test-song" }];
    playback.isPlaying = false;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  const render = () => act(() => root.render(<MusicPlayControl />));
  const button = (name: string) => {
    const match = container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
    expect(match, `需要可识别的${name}按钮`).not.toBeNull();
    return match!;
  };

  it("暂停时可识别播放、上一首和下一首", () => {
    render();
    expect(button("播放")).not.toBeDisabled();
    expect(button("上一首")).toBeDisabled();
    expect(button("下一首")).toBeDisabled();
  });

  it("随实际播放状态切换播放与暂停名称", () => {
    render();
    expect(button("播放")).not.toBeDisabled();
    playback.isPlaying = true;
    render();
    expect(button("暂停")).not.toBeDisabled();
    expect(container.querySelector('button[aria-label="播放"]')).toBeNull();
    playback.isPlaying = false;
    render();
    expect(button("播放")).not.toBeDisabled();
  });

  it("空队列保留名称但禁用全部操作", () => {
    playback.list = [];
    render();
    for (const name of ["上一首", "播放", "下一首"]) expect(button(name)).toBeDisabled();
  });

  it("多首队列的三个按钮继续调用原有动作", () => {
    playback.list.push({ bvid: "another-song" });
    render();
    act(() => {
      button("上一首").click();
      button("播放").click();
      button("下一首").click();
    });
    expect(playback.prev).toHaveBeenCalledTimes(1);
    expect(playback.togglePlay).toHaveBeenCalledTimes(1);
    expect(playback.next).toHaveBeenCalledTimes(1);
  });
});
