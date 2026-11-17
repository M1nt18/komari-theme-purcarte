# 节点流媒体检测组件

安装步骤见 [安装与升级](../../docs/INSTALL.md)。设置 `KOMARI_URL` 为自己的 HTTPS 监控站点后运行 `install.sh`；支持 systemd Linux、OpenWrt procd，以及 amd64、arm64、arm6、arm7、386。

安装器识别本机已有 Agent Token，经服务端身份接口确认 UUID。多份有效身份时停止，可用环境变量 `KOMARI_TOKEN` 指定；不会把全局注册密钥当作节点 Token。`--check` 仅预检，不注册、不检测。

首次安装检测一次；以后只有管理员在详情页点击“重新检测”才执行。页面刷新与服务重启不产生新扫描。访客只能刷新已保存结果。失败保留上次成功结果，断网上传重试不重跑检测。

worker 不监听端口，只轮询固定类型任务，本地固定检测参数，不接受远端任意命令。检测器从 `detector-manifest.json` 指定的 MediaUnlockTest 官方版本下载并验证 SHA256，许可保留在本目录。

凭据存于节点 `/etc/komari-unlock-worker/config.json`，不出现在进程参数；systemd 使用 DynamicUser + LoadCredential，OpenWrt 使用 nobody 和持久 overlay 状态目录。原 Komari Agent 和远程命令设置无需改动。

重新安装保留原配置。丢失绑定需先停止旧组件，等待离线两分钟且无活动任务，再显式 `--rebind`；服务端保留成功结果。

接口前缀 `/api/plugin/unlock-test/`：`worker/identify`、`worker/poll`、`worker/report`、`worker/rebind` 使用节点身份；`probe` 使用管理员会话；`snapshot` 只提供可见节点已解析结果，不公开 Token 或原始输出。

测试：`python -B -m unittest discover -v`。
