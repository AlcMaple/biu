import { EventEmitter } from "node:events";

/**
 * 版本变更总线：某个用户的某个 store 被写入后广播一次，唤醒挂着的长轮询请求。
 *
 * Why 不用定时轮询：客户端要「另一台设备一改就看到」，但按 800ms 去轮询 3 个 store
 * 就是 225 请求/分钟，既撞限流（60/min）也白烧这台内存紧张的机器。长轮询挂着的请求
 * 空闲时不消耗 CPU，只占一个连接；真有改动时由这里即时唤醒，延迟接近 0。
 *
 * **只在单进程部署下成立**——pm2 必须 fork 模式单实例（和 storage.ts 的互斥队列同一前提），
 * 开 cluster 会导致写入发生在 A 进程、等待挂在 B 进程，永远收不到通知。
 */
const bus = new EventEmitter();

// 每个等待中的客户端一个监听器，正常量级极小；调高上限只是为了不在多设备时刷警告
bus.setMaxListeners(100);

const keyOf = (mid: string) => `change:${mid}`;

/** 当前挂起的等待者数量，用于测试断言不泄漏监听器，也便于线上排查连接堆积 */
export function pendingWaiters(mid: string): number {
  return bus.listenerCount(keyOf(mid));
}

/** 某用户的数据发生写入，唤醒该用户所有挂起的 watch 请求 */
export function notifyChange(mid: string): void {
  bus.emit(keyOf(mid));
}

/**
 * 等待该用户的下一次写入，或超时。
 * @returns true = 等到了变更；false = 超时（客户端应重新发起下一轮长轮询）
 */
export function waitForChange(mid: string, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const key = keyOf(mid);

    const done = (changed: boolean) => {
      clearTimeout(timer);
      bus.off(key, onChange);
      resolve(changed);
    };
    const onChange = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);

    bus.once(key, onChange);
  });
}
