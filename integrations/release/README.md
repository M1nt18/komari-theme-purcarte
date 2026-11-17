# 构建与备份

唯一前端构建入口为 `npm run build`，打包入口为 `npm run package`。正式 React 组件直接集成预测、流媒体和详情窗口，不对压缩 JavaScript 做字符串替换。

`tools/package_release.py` 输出主题、配套服务和 SHA256 清单。主题包含构建提交号与逐文件 hash；服务包不含第三方检测二进制、数据库或凭据。

`backup.py` 使用 SQLite backup API 复制核心、ledger、unlock 三库，检查完整性并保留14天。核心路径读取 `/etc/komari-custom.env` 的 `KOMARI_SOURCE`。备份目录 `/var/backups/komari-custom` 为 root 私有，timer 每天北京时间03:15附近运行。

`python3 -B /opt/komari-maintenance/backup.py --restore-check` 在临时目录验证恢复，不覆盖运行库。这是本机备份；异地副本需要另行配置。节点本地凭据应纳入各自系统备份。

安装、兼容性和回滚见 [安装与升级](../../docs/INSTALL.md)。
