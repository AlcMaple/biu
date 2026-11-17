import { addToast } from "@heroui/react";

import { bindSleepTimer, checkSleepTimer, consumeSleepTimerOnEnded, useSleepTimer } from "@/store/sleep-timer";

vi.mock("@heroui/react", () => ({ addToast: vi.fn() }));

const makeAudio = (paused = false) => {
  const audio = { paused, loop: false, pause: vi.fn(), addEventListener: vi.fn() };
  audio.pause.mockImplementation(() => {
    audio.paused = true;
  });
  return audio;
};

let singleLoop = false;

const setup = (paused = false) => {
  const audio = makeAudio(paused);
  bindSleepTimer({ audio: audio as unknown as HTMLAudioElement, isSingleLoop: () => singleLoop });
  return audio;
};

describe("定时关闭", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    singleLoop = false;
    useSleepTimer.getState().cancel();
    useSleepTimer.setState({ waitSongEnd: false });
    vi.mocked(addToast).mockClear();
  });

  afterEach(() => {
    useSleepTimer.getState().cancel();
    vi.useRealTimers();
  });

  it("到点立即暂停并清掉定时", () => {
    const audio = setup();
    useSleepTimer.getState().start(10);
    vi.advanceTimersByTime(10 * 60_000 - 1000);
    expect(audio.pause).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(useSleepTimer.getState().endAt).toBeNull();
    expect(addToast).toHaveBeenCalledWith({ title: "定时关闭已暂停播放" });
  });

  it("勾选播完整首时，到点只进入等待，歌曲结束时才停且不切下一首", () => {
    const audio = setup();
    useSleepTimer.setState({ waitSongEnd: true });
    useSleepTimer.getState().start(10);
    vi.advanceTimersByTime(10 * 60_000);
    expect(audio.pause).not.toHaveBeenCalled();
    expect(useSleepTimer.getState().pending).toBe(true);

    expect(consumeSleepTimerOnEnded()).toBe(true);
    expect(useSleepTimer.getState().pending).toBe(false);
    expect(consumeSleepTimerOnEnded()).toBe(false);
  });

  it("单曲循环下等待期间关掉 loop，让歌曲能结束；停下后恢复循环", () => {
    singleLoop = true;
    const audio = setup();
    audio.loop = true;
    useSleepTimer.setState({ waitSongEnd: true });
    useSleepTimer.getState().start(10);
    vi.advanceTimersByTime(10 * 60_000);
    expect(audio.loop).toBe(false);

    audio.loop = true;
    checkSleepTimer();
    expect(audio.loop).toBe(false);

    consumeSleepTimerOnEnded();
    expect(audio.loop).toBe(true);
  });

  it("切后台计时器停摆后，醒来第一次检查就按截止时刻停", () => {
    const audio = setup();
    useSleepTimer.getState().start(10);
    checkSleepTimer(Date.now() + 60 * 60_000);
    expect(audio.pause).toHaveBeenCalledTimes(1);
  });

  it("到点时已经是暂停状态，即使勾了播完整首也直接结束定时", () => {
    setup(true);
    useSleepTimer.setState({ waitSongEnd: true });
    useSleepTimer.getState().start(10);
    vi.advanceTimersByTime(10 * 60_000);
    expect(useSleepTimer.getState().pending).toBe(false);
    expect(useSleepTimer.getState().endAt).toBeNull();
  });

  it("等待期间取消勾选播完整首，立即暂停", () => {
    const audio = setup();
    useSleepTimer.setState({ waitSongEnd: true });
    useSleepTimer.getState().start(10);
    vi.advanceTimersByTime(10 * 60_000);
    useSleepTimer.getState().setWaitSongEnd(false);
    expect(audio.pause).toHaveBeenCalledTimes(1);
  });

  it("取消定时后到点不再暂停", () => {
    const audio = setup();
    useSleepTimer.getState().start(10);
    useSleepTimer.getState().cancel();
    vi.advanceTimersByTime(20 * 60_000);
    expect(audio.pause).not.toHaveBeenCalled();
  });
});
