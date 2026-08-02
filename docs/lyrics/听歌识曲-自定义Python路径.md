# 听歌识曲：自定义 Python 路径

如果你的 Python 或 Conda 安装在非常见位置，导致听歌识曲功能提示"Python 未安装"，可以按本文找到正确路径后手动添加到代码中。

---

## 第一步：找到你的 Python 路径

### 方法一：通过命令提示符（推荐）

按 `Win + R`，输入 `cmd`，回车，然后依次运行以下命令：

```cmd
where python
where python3
where py
```

输出示例：
```
C:\Users\yourname\miniconda3\python.exe
```

如果 `where` 没有结果，再试：
```cmd
python -c "import sys; print(sys.executable)"
```

---

### 方法二：通过 Conda（如果你用的是 Conda/Miniconda/Miniforge）

打开 **Anaconda Prompt** 或普通 `cmd`，运行：

```cmd
conda info
```

在输出中找 `active env location` 或 `base environment` 这一行，例如：

```
     active env location : C:\Users\yourname\anaconda3
       base environment : C:\Users\yourname\anaconda3  (writable)
```

你的 Python 路径就是：
```
C:\Users\yourname\anaconda3\python.exe
```

也可以直接运行：
```cmd
conda run python -c "import sys; print(sys.executable)"
```

---

### 方法三：通过 PowerShell

```powershell
Get-Command python | Select-Object -ExpandProperty Source
```

---

### 方法四：通过 Electron 日志确认 App 找到了哪个 Python

App 启动后打开听歌识曲功能，然后查看日志文件：

- **路径**：`%APPDATA%\biu\logs\main.log`（将 `%APPDATA%` 粘贴到资源管理器地址栏）

搜索 `[shazam] found python:`，如果有这行说明找到了 Python；如果没有，说明 App 没找到任何 Python。

---

## 第二步：将你的路径添加到代码

找到文件 [`electron/ipc/shazam.ts`](../electron/ipc/shazam.ts)，定位到 `windowsPythonCandidates` 函数末尾的 `condaRoots` 数组。

### 示例

假设你通过第一步找到的路径是：
```
C:\Users\yourname\myenv\python.exe
```

在 `condaRoots` 数组末尾加上你的路径（**注意反斜杠要写两个 `\\`，或改用正斜杠 `/`**）：

```typescript
const condaRoots = [
  path.join(userHome, "anaconda3"),
  path.join(userHome, "miniconda3"),
  // ... 其他已有路径 ...

  // ↓ 在这里加上你自己的路径（只写到根目录，不含 python.exe）
  "C:\\Users\\yourname\\myenv",
];
```

如果是完整路径直接指向 `python.exe`，加到 `return` 数组里：

```typescript
return [
  "py",
  "python3",
  "python",
  // ... 其他已有路径 ...
  ...condaPaths,

  // ↓ 或者在这里直接写完整的 python.exe 路径
  "C:\\Users\\yourname\\myenv\\python.exe",
];
```

---

## 第三步：重新构建

修改完成后，运行：

```bash
pnpm build
```

重新打包即可。

---

## 常见 Conda/Python 安装位置速查

| 安装方式 | 默认 Python 路径 |
|---|---|
| Python.org（用户安装） | `C:\Users\{你的用户名}\AppData\Local\Programs\Python\Python3XX\python.exe` |
| Python.org（系统安装） | `C:\Program Files\Python3XX\python.exe` |
| Anaconda（用户安装） | `C:\Users\{你的用户名}\anaconda3\python.exe` |
| Miniconda（用户安装） | `C:\Users\{你的用户名}\miniconda3\python.exe` |
| Miniforge（用户安装） | `C:\Users\{你的用户名}\miniforge3\python.exe` |
| Anaconda（全局安装） | `C:\ProgramData\anaconda3\python.exe` |
| MS Store Python | `C:\Users\{你的用户名}\AppData\Local\Microsoft\WindowsApps\python.exe` |

> `{你的用户名}` 替换为实际用户名，即 `C:\Users\` 下的目录名。
