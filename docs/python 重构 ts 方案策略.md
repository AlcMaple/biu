# 听歌识曲

- 原理：通过 Python 的 shazamio 库将音频转换为 PCM 后向 Shazam 服务器发送请求并获取 Json 信息
- ts 方案：使用 Node 生态的node-shazam 等包或基于 WASM 的指纹生成库（如 shazamio-core 的 WebAssembly 移植版），直接在 Electron 的主进程中使用这些 npm 包，结合 fluent-ffmpeg 预处理音频
- 优势：消除了启动 Python 进程的开销和由于系统环境没有 shazamio 依赖造成的错误

# 人声分离

- 无法重构 ts

# 歌词打轴

- 无法重构 ts