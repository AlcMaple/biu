# Windows 依赖管理指南

本文档说明在 Windows 上开发 Biu 项目时，如何管理 pnpm 依赖、新增依赖、重装依赖、以及遇到问题时的修复路径。

> **核心原则**：`pnpm-lock.yaml` 是跨平台共享的版本锁定资产，**默认不要删**。它保证 Mac 和 Windows 装的是同一版本，避免"我这能跑他那不行"的幽灵问题。

---

## 一、场景速查表

| 场景 | 操作 | 说明 |
|---|---|---|
| 日常开发 | `pnpm dev` | 没动依赖直接启动 |
| **新增依赖** | `pnpm add <包名>` | 自动更新 package.json + pnpm-lock.yaml |
| 新增开发依赖 | `pnpm add -D <包名>` | 放到 devDependencies |
| 删除依赖 | `pnpm remove <包名>` | 同上 |
| 升级某个依赖 | `pnpm update <包名>` | 按 package.json 的版本范围升级 |
| **拉了新代码** | `pnpm install` | 根据 lockfile 同步队友的改动 |
| **环境坏了想重装** | 跑 `dev_tools\setup-win.bat` | 脚本会删 node_modules 并保留 lockfile |
| 核弹级修复 | 删 lockfile + 跑脚本 | 仅在上一条仍失败时使用 |

---

## 二、日常工作流

### 2.1 新增依赖

```cmd
pnpm add axios
pnpm add -D typescript
```

`pnpm add` 会自动做四件事：
1. 下载包
2. 写入 `package.json`
3. 更新 `pnpm-lock.yaml`
4. 装到 `node_modules`

完事后把两个文件一起提交：

```cmd
git add package.json pnpm-lock.yaml
git commit -m "chore: 新增 axios 依赖"
```

### 2.2 拉取新代码后

队友可能新增或升级了依赖，`pnpm install` 会根据 lockfile 把差异同步到本地：

```cmd
git pull
pnpm install
```

**不需要删任何文件**，pnpm 会自动增量处理。

### 2.3 启动和打包

```cmd
pnpm dev      :: 开发模式
pnpm build    :: 生产构建 + 打包 exe
```

---

## 三、重装依赖

### 3.1 正确姿势（99% 的情况）

直接跑一键脚本：

```cmd
dev_tools\setup-win.bat
```

脚本会自动：
1. 检查 node / git / pnpm 是否就位
2. 配置 Git 使用 HTTPS 代替 SSH（绕开 `app-builder-bin` 的 git+ssh 依赖）
3. 配置 pnpm 国内镜像和超时
4. 设置 Electron 二进制镜像环境变量
5. **删除 `node_modules`**（保留 `pnpm-lock.yaml`）
6. 运行 `pnpm install`，失败自动降级到 `--ignore-scripts` + 手动补装 Electron
7. 校验 `electron.exe` 和 `@rsbuild/core` 是否就位

保留 lockfile 的好处：装的是上次验证过能跑的版本，**不会引入新的 bug**。

### 3.2 核弹路径（仅当上面失败）

只有当 lockfile 本身被污染（罕见），才走这条：

```cmd
rmdir /s /q node_modules
del /f /q pnpm-lock.yaml
dev_tools\setup-win.bat
```

跑完后记得把重新生成的 lockfile 检查一下（`git diff pnpm-lock.yaml`），确认变动合理再提交。

---

## 四、什么时候必须跑 `setup-win.bat`

- 第一次 clone 项目到 Windows
- 换了 Node 大版本（比如 20 → 22）
- `pnpm install` 报奇怪的错（git SSH 认证、网络超时、二进制缺失）
- 手动删过全局 pnpm store（`pnpm store prune --force`）

**日常加减依赖不需要跑脚本**，`pnpm add / remove` 就够了。脚本是"出问题时的一键修复"。

---

## 五、常见错误与自救

### 5.1 `git@github.com: Permission denied (publickey)`

上游依赖 `@electron/rebuild` / `app-builder-lib` 里有一个 `git+ssh://github.com/...` 形式的依赖。没配 SSH Key 的机器会卡住。

**解决**：`setup-win.bat` 已经做了全局配置重写：

```cmd
git config --global url."https://github.com/".insteadOf "git@github.com:"
git config --global url."https://".insteadOf "git://"
```

手动跑一次就永久生效。

### 5.2 `rsbuild 不是内部或外部命令`

说明 `node_modules` 没装好。跑 `setup-win.bat` 重装即可。

### 5.3 `pnpm dev` 启动后白屏 / Electron 报错

Electron 二进制可能没下载。手动补装：

```cmd
node node_modules\electron\install.js
```

### 5.4 `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "cache" not found`

不是 pnpm 的命令，pnpm 9+ 没有 `pnpm cache`。清缓存用：

```cmd
pnpm store prune
```

---

## 六、红线（千万别做）

- ❌ 不要 `pnpm install --force`——会破坏 lockfile 一致性
- ❌ 不要只删 `pnpm-lock.yaml` 而留着 `node_modules`——两者对不上会触发奇怪行为
- ❌ 不要在 `.npmrc` 里加 `ignore-scripts=true`——会导致 Electron 二进制不下载，`pnpm dev` 起不来
- ❌ 不要在 Windows 和 Mac 上轮流生成 lockfile 互相覆盖——**谁先动依赖谁提交**，另一方只做 `pnpm install`

---

## 七、项目级配置说明

项目根目录的 [.npmrc](../.npmrc) 已经固化了以下配置（对所有开发者生效）：

```ini
registry=https://registry.npmmirror.com        # 国内镜像
fetch-timeout=100000                            # 下载超时 100s
fetch-retries=5                                 # 失败重试 5 次
electron_mirror=https://npmmirror.com/mirrors/electron/
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
public-hoist-pattern[]=*@heroui/*
engine-strict=true
```

所以 `git clone` 之后任何人跑 `pnpm install` 都默认走国内镜像，不需要手动配置。

`setup-win.bat` 里的 `pnpm config set registry ...` 是**全局**兜底（防止某些机器 `.npmrc` 没被识别）。两层保险。

---

## 八、一句话总结

- **加依赖**：`pnpm add <名>`
- **拉代码后**：`pnpm install`
- **环境坏了**：`dev_tools\setup-win.bat`
- **lockfile**：除非确认被污染，否则不要动它
