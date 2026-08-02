// pm2 部署配置 —— 单实例 fork 模式，禁止改成 cluster（见 src/lib/storage.ts
// 顶部注释：每 mid 的写入互斥队列只在单进程内有效）。
module.exports = {
  apps: [
    {
      name: "biu-sync-server",
      script: "./dist/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "150M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
