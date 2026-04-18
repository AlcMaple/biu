# 系统托盘实现原理与方案

## 概述

Biu 的系统托盘功能由三部分协作完成：

1. **托盘图标与菜单**（`electron/windows/tray.ts`）
2. **窗口关闭行为控制**（`electron/main.ts`）
3. **用户设置 UI**（`src/pages/settings/system-settings.tsx`）

托盘功能仅在 **非 macOS** 平台启用（macOS 有 Dock，托盘逻辑不同）。

---

## 文件地图

```
electron/
  main.ts                        窗口 close 事件、app 生命周期钩子
  windows/
    tray.ts                      托盘创建、菜单、左键/右键行为
  ipc/
    channel.ts                   window.close / window.minimize 等 IPC 通道名
    window.ts                    IPC handler 实现
  preload.ts                     暴露 closeWindow() 等 API 给 renderer

shared/
  types/app-setting.d.ts         closeWindowOption: "hide" | "exit" 类型
  settings/app-settings.ts       默认值 closeWindowOption: "hide"

src/
  pages/settings/
    system-settings.tsx          "窗口关闭" 单选框 UI
    index.tsx                    Settings 表单，持久化设置
```

---

## 核心原理

### 1. 托盘图标创建（`tray.ts`）

```
app ready
  └─ createTray(mainWindow, onExit)
       ├─ new Tray(iconPath)           # Linux: PNG，Windows: ICO
       ├─ tray.on("click")            # 左键：切换主窗口显示/隐藏
       └─ tray.setContextMenu(menu)   # 右键菜单
```

右键菜单项：

| 菜单项 | 行为 |
|--------|------|
| 播放/暂停 | `win.webContents.send(channel.player.togglePlay)` |
| 上一首 / 下一首 | 同上，发送对应 player channel |
| 显示/隐藏界面 | `win.show()` / `win.hide()` |
| 设置 | 显示主窗口并导航到 `/settings` |
| 退出程序 | 调用 `onExit()` → `app.quit()` |

左键点击逻辑：

```ts
// tray.ts ~L74
function toggleMainWindow() {
  if (win.isVisible()) {
    win.hide()
    destroyMiniPlayer()   // 同时关闭迷你播放器
  } else {
    win.show()
    win.focus()
  }
}
```

### 2. 窗口关闭行为（`main.ts`）

用户点击窗口关闭按钮时，触发 `mainWindow.on("close")` 事件。通过读取持久化设置 `closeWindowOption` 决定行为：

```
用户点击关闭按钮
  └─ mainWindow.on("close", event)
       ├─ app.quitting === true?  →  正常退出（来自 tray 退出按钮或系统关机）
       ├─ closeWindowOption === "hide"  →  event.preventDefault() + win.hide()
       └─ closeWindowOption === "exit" →  允许默认关闭行为，app 退出
```

关键标志位 `app.quitting`：

```ts
// main.ts
app.on("before-quit", () => { (app as any).quitting = true })
```

这个标志让 `close` 事件能区分「用户手动关窗」和「app.quit() 触发的关闭」，避免退出时被 `hide` 逻辑拦截。

### 3. 完整退出流程（`app.quit()` 路径）

```
tray 退出按钮
  └─ onExit()
       ├─ app.quitting = true
       └─ app.quit()
            ├─ app.on("before-quit")  →  再次确保 quitting = true
            └─ app.on("will-quit")
                 ├─ destroyTray()
                 ├─ destroyMiniPlayer()
                 ├─ destroyDesktopLyricsWindow()
                 ├─ unregisterShortcuts()
                 └─ saveDownloadTasks()
```

### 4. 设置持久化

`closeWindowOption` 存储在 electron-store（`AppSettings` store）中，默认值为 `"hide"`（关闭时最小化到托盘）。

```
renderer 设置页 → store.set IPC → appSettingsStore.set()
                                        ↓
main.ts close 事件 ←── appSettingsStore.get("closeWindowOption")
```

---

## 数据流图

```
┌─────────────────────────────────┐
│        Renderer (React)         │
│  settings/system-settings.tsx   │
│  RadioGroup: "hide" | "exit"    │
└────────────┬────────────────────┘
             │ store.set IPC
             ▼
┌─────────────────────────────────┐
│      Main Process (Electron)    │
│  appSettingsStore (electron-store)│
│  closeWindowOption: "hide"|"exit"│
└──────┬───────────────┬──────────┘
       │               │
       ▼               ▼
  mainWindow        createTray()
  .on("close")      右键菜单 → 退出
       │
       ├── "hide"  → win.hide()  ──→ 托盘继续运行
       └── "exit"  → 正常关闭   ──→ app 退出
```

---

## 平台差异

| 平台 | 托盘图标格式 | 托盘是否创建 |
|------|-------------|-------------|
| Windows | `.ico` | ✅ |
| Linux | `.png` | ✅ |
| macOS | — | ❌（跳过，使用 Dock） |

判断逻辑在 `main.ts`：

```ts
if (process.platform !== "darwin") {
  createTray(mainWindow, () => { ... })
}
```

---

## 扩展时的注意事项

- **新增托盘菜单项**：在 `tray.ts` 的 `Menu.buildFromTemplate([...])` 中追加，通过 `win.webContents.send()` 与 renderer 通信。
- **新增窗口关闭选项**（如"询问"）：在 `app-setting.d.ts` 扩展 `closeWindowOption` 联合类型，在 `main.ts` 的 `close` handler 中处理新分支。
- **macOS 支持**：macOS 的托盘通常通过 `app.dock` API 控制，逻辑与 Windows/Linux 不同，需单独处理。
