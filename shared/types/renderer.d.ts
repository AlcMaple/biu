declare global {
  type AppPlatForm = "macos" | "windows" | "linux";

  type StoreName = keyof StoreDataMap;

  interface ShazamCheckResult {
    ok: boolean;
    /** "python" = Python not found; "shazamio" = Python found but shazamio not installed */
    missingDep?: "python" | "shazamio";
    error?: string;
  }

  interface ShazamTrack {
    key: string;
    title: string;
    subtitle: string;
    images?: { coverart?: string; background?: string };
    url?: string;
  }

  interface ShazamMatchResult {
    track?: ShazamTrack;
    error?: string;
  }
  interface LocalMusicItem {
    id: string;
    path: string;
    dir: string;
    title: string;
    size: number;
    format: string;
    duration?: number;
    createdTime?: number;
  }

  interface ElectronAPI {
    /** 获取指定name的存储值 */
    getStore: <N extends StoreName>(name: N) => Promise<StoreDataMap[N] | undefined>;
    /** 设置指定name的存储值 */
    setStore: <N extends StoreName>(name: N, value: StoreDataMap[N]) => Promise<void>;
    /** 清除指定name的存储值 */
    clearStore: (name: StoreName) => Promise<void>;
    /** 打开系统目录选择对话框，返回选中的目录路径 */
    selectDirectory: (title?: string) => Promise<string | null>;
    /** 显示指定路径的文件 */
    showFileInFolder: (filePath: string) => Promise<boolean>;
    /** 打开系统文件选择对话框，返回选中的文件路径 */
    selectFile: () => Promise<string | null>;
    /** 打开系统图片多选对话框，返回选中的文件路径数组 */
    selectImages: () => Promise<string[]>;
    /** 打开本地目录（默认打开下载目录） */
    openDirectory: (path?: string) => Promise<boolean>;
    /** 在外部浏览器打开链接 */
    openExternal: (url: string) => Promise<boolean>;
    /** 获取本地安装的字体列表 */
    getFonts: () => Promise<IFontInfo[]>;
    /** 导航到指定路由 */
    navigate: (cb: (path: string) => void) => VoidFunction;
    /** 获取某个 cookie */
    getCookie: (key: string) => Promise<string | undefined>;
    /** 设置 cookie */
    setCookie: (name: string, value: string, expirationDate?: number) => Promise<void>;
    /** 搜索网易云歌曲 */
    searchNeteaseSongs: (params: SearchSongByNeteaseParams) => Promise<SearchSongByNeteaseResponse>;
    /** 获取网易云歌词 */
    getNeteaseLyrics: (params: GetLyricsByNeteaseParams) => Promise<GetLyricsByNeteaseResponse>;
    /** 在 LrcLib 搜索歌曲/歌词 */
    searchLrclibLyrics: (params: SearchSongByLrclibParams) => Promise<SearchSongByLrclibResponse[]>;
    /** 获取当前应用平台：macos | windows | linux */
    getPlatform: () => AppPlatForm;
    /** 更新网络代理设置 */
    setProxySettings: (proxySettings: ProxySettings) => Promise<void>;
    /** 上报当前播放状态到主进程（用于任务栏按钮切换） */
    updatePlaybackState: (isPlaying: boolean) => void;
    /** 订阅主进程下发的快捷键命令 */
    onShortcutCommand: (cb: (cmd: ShortcutCommand) => void) => VoidFunction;
    /** 注册快捷键，返回是否注册成功 */
    registerShortcut: ({ id, accelerator }: { id: ShortcutCommand; accelerator: string }) => Promise<boolean>;
    /** 注销指定快捷键 */
    unregisterShortcut: (id: ShortcutCommand) => Promise<void>;
    /** 注册所有快捷键 */
    registerAllShortcuts: () => Promise<void>;
    /** 注销所有快捷键 */
    unregisterAllShortcuts: () => Promise<void>;
    /** 订阅主进程下发的播放器命令（上一首、下一首、播放/暂停） */
    onPlayerCommand: (cb: (cmd: "prev" | "next" | "toggle") => void) => VoidFunction;
    /** 获取当前应用版本 */
    getAppVersion: () => Promise<string>;
    /** 判断是否为开发模式 */
    isDev: () => Promise<boolean>;
    /** 是否支持自动更新 */
    isSupportAutoUpdate: () => boolean;
    /** 检查更新 */
    checkAppUpdate: () => Promise<CheckAppUpdateResult>;
    /** 监听应用更新下载进度 */
    onUpdateAvailable: (cb: (updateInfo: AppUpdateReleaseInfo) => void) => VoidFunction;
    /** 下载更新 */
    downloadAppUpdate: () => Promise<void>;
    /** 监听应用更新下载进度 */
    onDownloadAppProgress: (cb: (payload: DownloadAppMessage) => void) => VoidFunction;
    /** 安装更新 */
    quitAndInstall: () => Promise<void>;
    /** 切换 mini/主窗口 */
    toggleMiniPlayer: () => Promise<void>;
    /** 显示/隐藏桌面歌词窗口，返回新的可见状态 */
    toggleDesktopLyrics: () => Promise<boolean>;
    /** 订阅桌面歌词窗口可见性变化（窗口被内部关闭时主进程推送） */
    onDesktopLyricsVisibilityChange: (cb: (visible: boolean) => void) => VoidFunction;
    /** 设置桌面歌词窗口鼠标穿透（锁定模式） */
    setDesktopLyricsIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => void;
    /** 获取桌面歌词窗口当前位置和大小 */
    getDesktopLyricsBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
    /** 设置桌面歌词窗口位置和大小 */
    setDesktopLyricsBounds: (bounds: Partial<{ x: number; y: number; width: number; height: number }>) => Promise<void>;
    /** 最小化窗口 */
    minimizeWindow: () => void;
    /** 最大化/还原窗口 */
    toggleMaximizeWindow: () => void;
    /** 关闭窗口 */
    closeWindow: () => void;
    /** 判断窗口是否最大化 */
    isMaximized: () => Promise<boolean>;
    /** 监听窗口最大化状态变化 */
    onWindowMaximizeChange: (cb: (isMaximized: boolean) => void) => VoidFunction;
    /** 判断窗口是否全屏 */
    isFullScreen: () => Promise<boolean>;
    /** 监听窗口全屏状态变化 */
    onWindowFullScreenChange: (cb: (isFullScreen: boolean) => void) => VoidFunction;
    /** 切换开发者工具 */
    toggleDevTools: () => void;
    /** 获取下载任务列表 */
    getMediaDownloadTaskList: () => Promise<MediaDownloadTask[]>;
    /** 同步下载任务列表 */
    syncMediaDownloadTaskList: (cb: (payload: MediaDownloadBroadcastPayload) => void) => VoidFunction;
    /** 添加下载任务 */
    addMediaDownloadTask: (media: MediaDownloadInfo) => Promise<void>;
    /** 添加下载任务列表 */
    addMediaDownloadTaskList: (mediaList: MediaDownloadInfo[]) => Promise<void>;
    /** 暂停下载任务 */
    pauseMediaDownloadTask: (id: string) => Promise<void>;
    /** 恢复下载任务 */
    resumeMediaDownloadTask: (id: string) => Promise<void>;
    /** 取消下载任务 */
    cancelMediaDownloadTask: (id: string) => Promise<void>;
    /** 重试下载任务 */
    retryMediaDownloadTask: (id: string) => Promise<void>;
    /** 清除下载任务列表 */
    clearMediaDownloadTaskList: () => Promise<void>;
    /** 扫描本地音乐文件 */
    scanLocalMusic: (dirs: string[]) => Promise<LocalMusicItem[]>;
    /** 删除本地音乐文件 */
    deleteLocalMusicFile: (filePath: string) => Promise<boolean>;
    /** 检查 Python 和 ShazamIO 是否可用 */
    checkShazamDeps: () => Promise<ShazamCheckResult>;
    /** 自动安装 ShazamIO（需要 Python 已存在） */
    installShazamio: () => Promise<{ ok: boolean; error?: string }>;
    /** 识别音频（传入 ArrayBuffer，返回识别结果） */
    recognizeSong: (audioBuffer: ArrayBuffer) => Promise<ShazamMatchResult>;
    /** 获取桌面捕获源列表（用于系统音频采集） */
    getDesktopSources: () => Promise<Array<{ id: string; name: string }>>;
    /** 检查 demucs + whisperx 依赖是否已安装 */
    checkWhisperXDeps: () => Promise<{ ok: boolean; missingDep?: string; error?: string }>;
    /** 自动安装 demucs + whisperx（需要 Python 已存在） */
    installWhisperXDeps: () => Promise<{ ok: boolean; error?: string }>;
    /** 后台启动 demucs + whisperx 歌词时间轴对齐（fire-and-forget，完成后通过 onSyncLyricsWithWhisperXDone 通知） */
    startSyncLyricsWithWhisperX: (params: {
      audioUrl: string;
      lrc: string;
      language?: string;
      localFilePath?: string;
    }) => void;
    /** 订阅歌词同步完成事件（主进程推送） */
    onSyncLyricsWithWhisperXDone: (
      cb: (result: { syncedLrc: string | null; originalLrc: string; error: string | null }) => void,
    ) => VoidFunction;
    /** 订阅歌词同步进度事件（主进程推送，fire-and-forget 期间持续推送） */
    onSyncLyricsWithWhisperXProgress: (
      cb: (progress: { stage: "download" | "demucs" | "whisperx"; pct: number }) => void,
    ) => VoidFunction;
  }

  interface Window {
    electron: ElectronAPI;
  }
}

export {};
