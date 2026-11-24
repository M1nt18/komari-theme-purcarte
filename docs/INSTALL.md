# 安装与升级

## 主题

从本项目 Releases 下载 `komari-theme-purcarte-v1.2.1.zip`，在 Komari 后台上传并启用 PurCarte。
压缩包根目录包含 `komari-theme.json`、`preview.png`、`dist/` 和构建清单 `BUILD.json`；Linux/Windows 打包均使用标准 `/` 路径。

基础监控、卡片、柱图及悬浮详情使用 Komari 原有 API。周期账本、流量预测和手动流媒体检测使用下面的配套服务。
主题不会替换 Komari 核心或自动修改节点设置；升级前导出旧主题设置并备份当前主题目录。

## 配套服务（可选）

适用于 systemd Linux 主机，Python 3.10+，只依赖标准库。已按 Komari 1.2.5 的 SQLite `clients`、`records`、`records_long_term` 格式验证。
其他版本先运行预检，特别是 1.6 系列迁移后的数据格式不能直接假定兼容。

解压 `komari-custom-services-v1.2.1.zip` 后：

```bash
python3 install.py --source /opt/komari/data/komari.db --origin https://monitor.example.com --check
sudo python3 install.py --source /opt/komari/data/komari.db --origin https://monitor.example.com
```

`--core` 默认 `http://127.0.0.1:25774`，可指定本机 Komari API 地址。源库和所在目录需允许服务账户只读访问，包括活跃 WAL/SHM。
安装器仅写独立服务目录、状态目录和服务配置，不写核心数据库。修改过的 `traffic_reset_day`/`traffic_baseline_usage` 字段存在时会被使用；普通库无这两个字段时按每月1日重置、不设置校准。

将 `nginx/komari-custom.conf.example` 的 location 加到现有 HTTPS server block，保留原证书、根路径代理和 WebSocket 配置，运行 `nginx -t` 后 reload Nginx。
`/etc/komari-custom.env` 中的 `KOMARI_PUBLIC_ORIGIN` 必须和访问站点的 HTTPS Origin 一致，供网页手动检测鉴权校验。

服务 `komari-traffic-ledger` 监听 `127.0.0.1:25776`。状态存储于 `/var/lib/komari-traffic-ledger/ledger.sqlite` 和 `unlock.sqlite`。
每日备份 timer 使用 SQLite backup API 备份核心及两份独立库到 `/var/backups/komari-custom`，保留14天；这是本机备份，异地副本需另行配置。
默认备份服务单元和环境配置；需要备份现有 Nginx 文件时，可在环境文件添加 `KOMARI_BACKUP_CONFIG`，用冒号分隔文件的绝对路径。

## 每台节点的流媒体检测

在已运行 Komari Agent 的机器上以 root 执行，域名换成自己的监控站点：

```bash
curl -fLsS https://monitor.example.com/unlock/install.sh -o /root/komari-unlock-install.sh
KOMARI_URL=https://monitor.example.com sh /root/komari-unlock-install.sh
```

安装器通过本机已有 Agent Token 识别节点，不需要 SSH 密码，不开放新的监听端口，不更改 `--disable-web-ssh`。
支持 systemd Linux 与 OpenWrt procd，以及 amd64、arm64、arm6、arm7、386。检测器从 MediaUnlockTest 官方固定发布地址下载并验证 SHA256，发布包不包含第三方二进制。
首次安装会执行一次检测；成功后页面只读保存结果，管理员点击“重新检测”才再次执行。访客只能刷新已保存结果。

重新安装应保留 `/etc/komari-unlock-worker/config.json`。丢失配置需先停止原组件、等待两分钟且无活动任务，再显式使用 `--rebind`，以免两份组件争抢同一个节点。
`--check` 只预检环境和身份，不安装、不注册、不检测。

## 设置迁移

- 旧的 `backagroundAlignment` 拼写自动迁移为 `backgroundAlignment`。
- 流量重置日/起始校准应在核心节点管理中设置，主题面板不再提供无效的独立起始值控件。
- 旧版写死在源码的特殊节点任务不再公开内置：升级后在主题设置的“机器卡片 → 各节点卡片延迟任务”选择原任务。
- 网格固定使用连续流量条和时间线；表格圆环/条形样式的选项只控制表格。浏览器偏好和站点默认设置分开保存。
- 流量预测与流媒体标签可独立隐藏。关掉显示开关不会删除账本或检测结果，也不会触发检测。

## 校验与回滚

发布页的 `SHA256SUMS.txt` 用于校验两个压缩包。源码 npm lockfile 固定依赖，`npm ci && npm test && npm run build && npm run package` 可重建。
回滚主题可重新启用备份的旧主题目录。配套服务升级前备份其源码和独立数据库；不要用回滚操作删除账本或恢复过期状态覆盖新用量。
