# 周期流量账本与检测接口

`server.py` 监听本机 `127.0.0.1:25776`，只读 Komari 核心 SQLite；账本和检测状态分别保存于独立 `ledger.sqlite`、`unlock.sqlite`。安装见 [安装与升级](../../docs/INSTALL.md)。

- 按节点和15分钟桶合并长短期采样，重复记录不重复计费；上、下行累计后按 sum/max/min/up/down 计算。
- 账期使用北京时间，月末日期按实际月长处理；没有新采样也会切换账期，重启不清空既有用量。
- 有 `traffic_reset_day` / `traffic_baseline_usage` 自定义列时使用它们；普通库按每月1日重置。校准仅影响当前周期，不沿用无录入时间的旧值。
- 前端每15秒更新；跨周期或超过120秒未同步时失效旧快照。接口失败时显示待同步，不回退到网卡计数或浏览器存储。
- 只能重建已有历史。历史不足会标记 `history_partial`，无法还原漏报字节。
- API 将 Cookie / Authorization 转发给核心 `/api/nodes` 确认可见范围；访客只获得可见节点。手动检测另需核心管理员会话和同源 JSON 请求。
- 健康检查为 `/_health`，仅本机访问；快照是只读操作，过期任务由后台维护。

测试：`python -B -m unittest discover -v`；前端失效规则见 `traffic-store.test.mjs`。采样格式兼容性、目录读取权限和备份要求均见安装文档。
