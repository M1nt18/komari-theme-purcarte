# 流量预测适配

前端直接集成于 `src/features/netforecast/`，首页入口打开独立总览窗口；详情标签显示单机预测。

`from-ledger.mjs` 适配 `/api/plugin/net-forecast/overview` 的持久账本数据，卡片与预测使用相同账期、用量、配额和校准。近七个完整自然日作为样本，零用量日计入，缺测日不用于日均；历史不足明确显示“积累样本”，请求失败不伪造预测。

`engine.mjs` 的日期与计费计算参考 [Komari-Plugin-NetForecast](https://github.com/livingfree2023/Komari-Plugin-NetForecast) 提交 `7dd815f0e1a711f2192d3f5f270156a44f6b96ac`，MIT 许可见 `UPSTREAM-LICENSE.txt`。未使用的旧预览计算及网卡回退逻辑已移除。

图表柱形表示历史日流量，实线表示累计计费，虚线表示未来预测；未来不生成真实用量柱，缺测处断线。配额与日用量使用独立轴。

测试包含账本对齐、采样完整性、跨周期失效、有限坐标和窄屏轴布局，统一运行 `npm test`。
