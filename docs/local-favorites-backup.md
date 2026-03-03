# 本地收藏夹数据备份与还原

本地收藏夹的数据（收藏夹列表及其内容）以 JSON 文件形式存储在系统的**文档目录**下，与应用程序的安装位置完全分离，卸载应用不会删除这些文件。

> 存储的均为元数据（标题、封面 URL、资源 ID 等），不含音频文件本身，跨设备还原后内容仍通过网络播放。

---

## 文件位置

### macOS

```
~/Documents/Biu/
├── local-favorites.json   # 收藏夹列表（名称、封面、排序等）
└── local-fav-items.json   # 各收藏夹中的内容
```

在 Finder 中打开：**前往 → 个人文件夹 → Documents → Biu**

### Windows

```
C:\Users\<用户名>\Documents\Biu\
├── local-favorites.json
└── local-fav-items.json
```

在文件资源管理器地址栏输入 `%USERPROFILE%\Documents\Biu` 回车即可打开。

---

## 备份

1. 完全退出 Biu
2. 将整个 `Biu` 文件夹复制到安全位置（移动硬盘、云盘等）

---

## 还原

1. 完全退出 Biu
2. 将备份的 `local-favorites.json` 和 `local-fav-items.json` 放入对应目录，覆盖原有文件
3. 重新启动 Biu，本地收藏夹即恢复

---

## 跨设备迁移

1. 在原设备上按上述步骤备份
2. 在新设备上安装 Biu 并启动一次（自动创建 `Documents/Biu/` 目录）
3. 完全退出 Biu
4. 将两个 JSON 文件复制到新设备对应目录，覆盖原有文件
5. 重新启动 Biu
